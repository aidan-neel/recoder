import type { ChatMessage } from './llm.js';
import { streamChatCompletion, LlmError } from './llm.js';
import { streamedMessage } from './response-text.js';
import { extractJsonValue } from './json-extract.js';
import { parseActions, formatToolResults, type EvidenceStore, type ToolCallReport } from './evidence.js';
import { REVIEW_POLICY } from './review-policy.js';
import type { RoleConfig } from './models.js';
import { isAuthFailure } from './planner.js';
import type { ReviewReasoningEntry } from '@recoder/shared';
import { CHAT_STYLE, RETRIEVAL_EXAMPLES } from './prompts';
import { currentReviewControl, reviewNow, reviewPausePoint } from './review-control.js';

export class ReviewAbortedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ReviewAbortedError';
	}
}

export class AuthConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AuthConfigError';
	}
}

export class ModelBudget {
	used = 0;
	constructor(
		readonly limit: number = REVIEW_POLICY.maxModelCalls,
		/** Calls held back from ordinary spending; raised while later stages need a guaranteed share. */
		public reserve: number = REVIEW_POLICY.reserveCallsForConsolidation
	) {}
	remaining(): number {
		return Math.max(0, this.limit - this.used);
	}
	canSpend(n = 1, opts?: { consumeReserve?: boolean }): boolean {
		const hold = opts?.consumeReserve ? 0 : this.reserve;
		return this.used + n + hold <= this.limit;
	}
	spend(): void {
		this.used++;
	}
	snapshot(): { used: number; remaining: number; reserved: number; limit: number } {
		return { used: this.used, remaining: this.remaining(), reserved: this.reserve, limit: this.limit };
	}
}

export function canLaunchInvestigation(deadlineAt: number, budget: ModelBudget): boolean {
	return budget.canSpend(1) && reviewNow() + REVIEW_POLICY.reserveMsForConsolidation < deadlineAt;
}

export interface JsonAgentOptions<T> {
	label: string;
	system: string;
	user: string;
	config: RoleConfig;
	budget: ModelBudget;
	evidence: EvidenceStore;
	maxTurns: number;
	signal: AbortSignal;
	deadlineAt: number;
	consumeReserve?: boolean;
	parse: (raw: unknown) => T | null;
	validationError?: (raw: unknown) => string;
	/** A minimal valid final answer, quoted back when the model gets the shape wrong. */
	finalExample?: string;
	/** Action request examples quoted back on a malformed reply; defaults to read-only retrieval. */
	actionExamples?: string;
	onProgress?: (state: 'queued' | 'running' | 'retrieval', elapsedMs: number, detail: string) => void;
	onLog?: (message: string) => void;
	/** Accumulated provider reasoning for a turn, upserted by `id`. */
	onReasoning?: (reasoning: Pick<ReviewReasoningEntry, 'id' | 'text' | 'status' | 'summary'>) => void;
	onTool?: (tool: ToolCallReport) => void;
	onMessage?: (message: { id: string; text: string; status: 'streaming' | 'done' | 'error' }) => void;
	getDiscussion?: () => string;
}

export async function runJsonAgent<T>(opts: JsonAgentOptions<T>): Promise<{ value: T | null; error?: string }> {
	// Reserve time throughout an investigation, not merely when dispatching it.
	const deadlineAt = opts.deadlineAt - (opts.consumeReserve ? 0 : REVIEW_POLICY.reserveMsForConsolidation);
	const messages: ChatMessage[] = [
		{ role: 'system', content: opts.system + '\nIn every JSON response, put "message" first: a concise, reader-facing Markdown explanation of your current investigation or conclusion. Then include the required structured fields. Describe actual evidence and decisions; do not narrate JSON formatting or budget compliance. This text is shown live to the developer. ' + CHAT_STYLE },
		{ role: 'user', content: opts.user }
	];
	let repaired = 0;
	let lastError = 'no model output';
	const shapes = `${opts.actionExamples ?? RETRIEVAL_EXAMPLES}\nTo finish, reply with ONLY the final JSON object${opts.finalExample ? `, for example:\n${opts.finalExample}` : '.'}\nNo prose outside the JSON, no code fences.`;
	// Schema repairs cost model calls, but must not consume an evidence round.
	// Each successful retrieval advances the investigation; the final turn is
	// reserved for the result, with the global budget/deadline enforced throughout.
	let turn = 1;
	for (let call = 1; call <= opts.maxTurns + REVIEW_POLICY.schemaRepairAttempts; call++) {
		throwIfAborted(opts.signal);
		await reviewPausePoint(opts.signal);
		throwIfAborted(opts.signal);
		if (reviewNow() >= deadlineAt) return { value: null, error: 'Investigation deadline reached; remaining time reserved for consolidation' };
		if (!opts.budget.canSpend(1, { consumeReserve: opts.consumeReserve })) {
			return { value: null, error: 'model-call budget exhausted' };
		}
		const lastTurn = turn >= opts.maxTurns || !opts.budget.canSpend(2, { consumeReserve: opts.consumeReserve });
		if (lastTurn && !messages.at(-1)?.content.startsWith('This is your final turn.')) messages.push({ role: 'user', content: 'This is your final turn. Return the required compact result JSON using available evidence, with the reader-facing "message" first. Do not request retrieval. Omit other optional fields when unnecessary.' });
		opts.budget.spend();
		opts.onLog?.(`${opts.label} model turn ${turn}/${opts.maxTurns} (${opts.config.model})`);
		const started = Date.now();
		const reasoningId = `reason_${opts.label.slice(0, 24)}_${turn}_${Math.random().toString(36).slice(2, 8)}`;
		let reasoningText = '';
		let reasoningEmittedAt = 0;
		const flushReasoning = (status: ReviewReasoningEntry['status'] = 'streaming') => {
			if (!opts.onReasoning || !reasoningText) return;
			// ChatGPT sends a summary, not its reasoning; keep the timing, drop the text.
			if (opts.config.provider === 'codex') opts.onReasoning({ id: reasoningId, text: '', status, summary: true });
			else opts.onReasoning({ id: reasoningId, text: reasoningText, status });
		};
		// Cut off runaway reasoning: a stuck model otherwise thinks until the call times out.
		const callAbort = new AbortController();
		const forwardAbort = () => callAbort.abort();
		opts.signal.addEventListener('abort', forwardAbort, { once: true });
		// Pausing the review stops this call; it is re-run on resume.
		const control = currentReviewControl();
		const pauseSignal = control?.pauseSignal;
		pauseSignal?.addEventListener('abort', forwardAbort, { once: true });
		let overthought = false;
		let output: string;
		let response = '';
		let responseEmittedAt = 0;
		const responseId = `message_${reasoningId}`;
		const flushResponse = (status: 'streaming' | 'done' | 'error') => {
			const text = streamedMessage(response);
			if (text) opts.onMessage?.({ id: responseId, text, status });
		};
		try {
			const discussion = opts.getDiscussion?.();
			output = await streamChatCompletion({
				provider: opts.config.provider,
				reasoningEffort: opts.config.reasoningEffort,
				baseUrl: opts.config.baseUrl,
				apiKey: opts.config.apiKey,
				model: opts.config.model,
				messages: discussion ? [...messages, { role: 'user', content: `Developer conversations since the review started (consider these with the review evidence):\n${discussion}` }] : messages,
				jsonMode: true,
				temperature: 0,
				maxTokens: 8000,
				timeoutMs: Math.min(REVIEW_POLICY.perCallDeadlineMs, Math.max(1, deadlineAt - reviewNow())),
				signal: callAbort.signal,
				onReasoning: opts.onReasoning
					? (chunk) => {
							reasoningText = (reasoningText + chunk).slice(0, 64_000);
							if (!overthought && (reasoningText.length > REVIEW_POLICY.maxReasoningChars || isLooping(reasoningText))) {
								overthought = true;
								opts.onLog?.(`${opts.label} reasoning ran long; asking for an answer`);
								callAbort.abort();
							}
							const now = Date.now();
							// Throttle: reasoning can stream token-by-token, and every
							// emit persists the review snapshot.
							if (now - reasoningEmittedAt > 250) {
								reasoningEmittedAt = now;
								flushReasoning();
							}
						}
					: undefined,
				onProgress: (state, elapsedMs) =>
					opts.onProgress?.(state, elapsedMs, state === 'queued' ? 'Waiting for a model slot' : `Running ${opts.label}`)
			}, (chunk) => {
				response += chunk;
				if (Date.now() - responseEmittedAt > 100) {
					responseEmittedAt = Date.now();
					flushResponse('streaming');
				}
			});
			response = output;
			flushResponse('done');
		} catch (err) {
			opts.signal.removeEventListener('abort', forwardAbort);
			pauseSignal?.removeEventListener('abort', forwardAbort);
			if (!opts.signal.aborted && pauseSignal?.aborted) {
				// Paused mid-call: give the call back and redo this turn after resume.
				flushResponse('done');
				flushReasoning('done');
				opts.budget.used = Math.max(0, opts.budget.used - 1);
				call--;
				continue;
			}
			flushResponse('error');
			flushReasoning(overthought ? 'done' : 'error');
			if (isAuthFailure(err)) throw new AuthConfigError(err instanceof Error ? err.message : String(err));
			if (!opts.signal.aborted && (overthought || (err instanceof LlmError && /timed out|stalled|socket|connection/i.test(err.message))) && repaired < REVIEW_POLICY.schemaRepairAttempts && turn <= opts.maxTurns) {
				repaired++;
				lastError = overthought ? 'reasoning ran too long without an answer' : (err as Error).message;
				messages.push({ role: 'user', content: `You spent too long thinking without replying. Stop deliberating and reply now with JSON only: request the evidence you need, or give your final result with what you already know.\n\n${shapes}` });
				continue;
			}
			if (opts.signal.aborted || (!overthought && err instanceof LlmError && /cancel/i.test(err.message))) {
				throw new ReviewAbortedError('review aborted');
			}
			lastError = err instanceof Error ? err.message : String(err);
			opts.onLog?.(`${opts.label} failed: ${lastError}`);
			if (/output truncated/i.test(lastError) && repaired < REVIEW_POLICY.schemaRepairAttempts && turn <= opts.maxTurns) {
				repaired++;
				messages.push({ role: 'user', content: 'Your response exceeded the output limit. Return compact valid JSON. Keep explanations short, omit optional fields and repeated gaps, and prioritize the most important findings.' });
				continue;
			}
			return { value: null, error: lastError };
		}
		opts.signal.removeEventListener('abort', forwardAbort);
		pauseSignal?.removeEventListener('abort', forwardAbort);
		flushReasoning('done');
		let parsed: unknown;
		try {
			parsed = extractJsonValue(output);
		} catch (err) {
			lastError = err instanceof Error ? err.message : 'invalid JSON';
			if (repaired < REVIEW_POLICY.schemaRepairAttempts && turn <= opts.maxTurns) {
				repaired++;
				messages.push({ role: 'assistant', content: output });
				messages.push({
					role: 'user',
					content: `Your previous reply was not valid JSON (${lastError}).\n\n${shapes}`
				});
				continue;
			}
			return { value: null, error: lastError };
		}
		if (!streamedMessage(output) && parsed && typeof parsed === 'object' && 'message' in parsed && typeof parsed.message === 'string') {
			opts.onMessage?.({ id: responseId, text: parsed.message, status: 'done' });
		}
		const actions = parseActions(parsed);
		if (actions && !lastTurn && opts.budget.canSpend(1, { consumeReserve: opts.consumeReserve }) && reviewNow() < deadlineAt) {
			opts.onProgress?.('retrieval', Date.now() - started, `Reading repository evidence for ${opts.label}`);
			const results = await opts.evidence.executeRound(actions, opts.signal, opts.onTool);
			for (const result of results) {
				if (result.ok && result.path) opts.onLog?.(`Reading ${result.path}${result.startLine ? `:${result.startLine}` : ''}`);
			}
			messages.push({ role: 'assistant', content: output });
			messages.push({
				role: 'user',
				content:
					formatToolResults(results) +
					(turn + 1 >= opts.maxTurns
						? '\n\nThis is your final turn. Finish with the required JSON result. Do not request more retrieval.'
						: '\n\nContinue. Finish with the required JSON when you have enough evidence.')
			});
			turn++;
			continue;
		}
		const value = opts.parse(parsed);
		if (value) return { value };
		lastError = opts.validationError?.(parsed) ?? 'output did not match the required schema';
		if (repaired < REVIEW_POLICY.schemaRepairAttempts && turn <= opts.maxTurns && !actions) {
			repaired++;
			messages.push({ role: 'assistant', content: output });
			messages.push({
				role: 'user',
				content: `Your JSON was neither a retrieval request nor a valid final result. Problems: ${lastError}.\n\n${shapes}`
			});
			continue;
		}
		if (actions) return { value: null, error: lastTurn ? 'final turn requested retrieval instead of completing' : 'No model capacity or investigation time remained to inspect the requested evidence' };
		return { value: null, error: lastError };
	}
	return { value: null, error: lastError };
}

/** The tail of the reasoning keeps reappearing: the model is going in circles. */
export function isLooping(text: string): boolean {
	if (text.length < 4_000) return false;
	const tail = text.slice(-240);
	let count = 0;
	for (let at = text.indexOf(tail); at !== -1 && count < 3; at = text.indexOf(tail, at + 1)) count++;
	return count >= 3;
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw new ReviewAbortedError('review aborted');
}
