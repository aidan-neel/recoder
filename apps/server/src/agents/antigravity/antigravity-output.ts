import type { TokenUsage } from '@recoder/shared';
import { z } from 'zod';
import { LlmError, UsageLimitError } from '../../models/llm/errors';
import type { CliExit } from '../cli-stream';
import type { AgentEvent, AgentReply } from '../contract';
import { quotedLine } from '../quoted-line';
import { ANTIGRAVITY_LOGIN } from './antigravity-process';

const QUOTED_CHARS = 300;

const EVENT_QUOTED_CHARS = 120;

const SIGNED_OUT =
	/please sign in|not (?:signed|logged) in|launch the cli without arguments to sign in|authentication required|failed to authenticate|unauthenticated|auth_revoked|invalid api key|oauth (?:token|session)/i;

const SPENT_CREDITS = /out of credits|insufficient credit|billing|payment required/i;

const USAGE_CAP =
	/quota|usage limit|hit your [\w\s]*limit|limit reached|out of (?:usage|extra usage)|resets? (?:at|in)\b|(?:daily|weekly|monthly|plan) limit/i;

const THROTTLED = /rate.?limit|too many requests|resource_exhausted/i;

const OVERLOADED = /overloaded|high demand|model capacity/i;

const TRUNCATED = /response (?:was |may be )?truncated|max[_\s]?output[_\s]?tokens/i;

const agyUsageSchema = z.object({
	input_tokens: z.number().optional(),
	output_tokens: z.number().optional(),
	thinking_tokens: z.number().optional(),
	cache_read_tokens: z.number().optional(),
	total_tokens: z.number().optional()
});

type AgyUsage = z.infer<typeof agyUsageSchema>;

const initEventSchema = z.object({
	event: z.literal('init'),
	conversation_id: z.string()
});

const stepUpdateSchema = z.object({
	event: z.literal('step_update'),
	step_update: z.object({
		conversation_id: z.string().optional(),
		step_index: z.number(),
		state: z.string(),
		step_type: z.string().optional(),
		text_delta: z.string().optional(),
		thinking_delta: z.string().optional(),
		error_message: z.string().optional(),
		usage: agyUsageSchema.optional()
	})
});

const resultBodySchema = z.object({
	conversation_id: z.string().optional(),
	status: z.string(),
	finished_reason: z.string().optional(),
	response: z.string().optional(),
	error: z.string().optional(),
	usage: agyUsageSchema.optional()
});

const resultEventSchema = z.object({
	event: z.literal('result'),
	result: resultBodySchema
});

const agyStderrSchema = z.object({
	short_error: z.string().optional(),
	message: z.string().optional(),
	error: z.string().optional(),
	status: z.string().optional(),
	code: z.union([z.string(), z.number()]).optional(),
	http_status: z.number().optional(),
	retryable: z.boolean().optional()
});

type ResultBody = z.infer<typeof resultBodySchema>;

interface StderrDetails {
	message?: string;
	httpStatus?: number;
	canonical?: string;
	retryable?: boolean;
}

export function isSignedOutOutput(text: string): boolean {
	return SIGNED_OUT.test(text);
}

/**
 * Converts `agy`'s usage object to Recoder's {@link TokenUsage}. `agy` reports uncached prompt tokens in
 * `input_tokens` and prompt-cache hits separately in `cache_read_tokens`, while `output_tokens` already includes
 * `thinking_tokens`.
 */
function tokenUsage(usage: AgyUsage): TokenUsage {
	const cachedInputTokens = usage.cache_read_tokens ?? null;
	const inputTokens = usage.input_tokens === undefined ? null : usage.input_tokens + (cachedInputTokens ?? 0);
	const outputTokens = usage.output_tokens ?? null;

	return {
		inputTokens,
		outputTokens,
		totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
		cachedInputTokens,
		cacheWriteInputTokens: null,
		reasoningOutputTokens: usage.thinking_tokens ?? null
	};
}

function addTokenUsage(total: TokenUsage | undefined, next: TokenUsage): TokenUsage {
	if (!total) return next;

	const sum = (left: number | null, right: number | null) =>
		left === null && right === null ? null : (left ?? 0) + (right ?? 0);

	const inputTokens = sum(total.inputTokens, next.inputTokens);
	const outputTokens = sum(total.outputTokens, next.outputTokens);

	return {
		inputTokens,
		outputTokens,
		totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
		cachedInputTokens: sum(total.cachedInputTokens, next.cachedInputTokens),
		cacheWriteInputTokens: null,
		reasoningOutputTokens: sum(total.reasoningOutputTokens, next.reasoningOutputTokens)
	};
}

function parseJsonObject(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

/** Extracts structured `AGY_ERROR: {...}` metadata or the primary error line from `stderr`, always redacted. */
function inspectStderr(stderr: string): StderrDetails {
	const lines = stderr
		.split('\n')
		.map((item) => item.trim())
		.filter(Boolean);

	for (let index = lines.length - 1; index >= 0; index--) {
		const line = lines[index] ?? '';
		const match = /^AGY_ERROR:\s*(\{.+\})$/.exec(line);

		if (!match?.[1]) continue;

		const parsed = agyStderrSchema.safeParse(parseJsonObject(match[1]));

		if (!parsed.success) continue;

		const rawText = parsed.data.short_error ?? parsed.data.message ?? parsed.data.error;
		const numericCode = typeof parsed.data.code === 'number' ? parsed.data.code : undefined;

		return {
			message: rawText ? quotedLine(rawText, QUOTED_CHARS) : undefined,
			httpStatus: parsed.data.http_status ?? numericCode,
			canonical: typeof parsed.data.status === 'string' ? parsed.data.status : undefined,
			retryable: parsed.data.retryable
		};
	}

	const chosen = lines.find((item) => /^error:/i.test(item)) ?? lines.at(-1);

	return { message: chosen ? quotedLine(chosen, QUOTED_CHARS) : undefined };
}

/** Maps a failed Antigravity turn or stderr diagnostic to the contract's `LlmError` / `UsageLimitError`. */
export function antigravityError(rawMessage: string, details: StderrDetails = {}, finishedReason?: string): LlmError {
	const clean = quotedLine(rawMessage || details.message || 'Antigravity request failed.', QUOTED_CHARS);
	const combined = `${clean} ${details.canonical ?? ''}`;

	if (details.httpStatus === 401 || details.canonical === 'UNAUTHENTICATED' || SIGNED_OUT.test(combined)) {
		return new LlmError(
			401,
			`Antigravity is not signed in (${clean}). Run "${ANTIGRAVITY_LOGIN}" in a terminal, then retry.`
		);
	}

	if (finishedReason === 'max_tokens' || TRUNCATED.test(combined)) {
		return new LlmError(0, 'Antigravity reply was truncated at its output limit.');
	}

	if (details.httpStatus === 402 || SPENT_CREDITS.test(combined)) {
		return new UsageLimitError(402, clean);
	}

	if (
		details.canonical === 'QUOTA_EXHAUSTED' ||
		USAGE_CAP.test(combined) ||
		(details.httpStatus === 429 && details.retryable === false)
	) {
		return new UsageLimitError(429, clean);
	}

	if (details.httpStatus === 429 || THROTTLED.test(combined)) {
		return new LlmError(429, clean);
	}

	if (details.httpStatus === 529 || OVERLOADED.test(combined)) {
		return new LlmError(529, clean);
	}

	const status = details.httpStatus && details.httpStatus >= 400 ? details.httpStatus : 0;

	return new LlmError(status, clean);
}

function missingResultError(lastStdout: string, exit: CliExit): LlmError {
	const stderr = inspectStderr(exit.stderr);
	const stdoutLine = lastStdout.trim() ? quotedLine(lastStdout.trim(), QUOTED_CHARS) : undefined;

	if (exit.code === 0) {
		const sample = stdoutLine ?? stderr.message;

		return new LlmError(
			0,
			`Antigravity output could not be parsed: ${sample ? `the last line was "${sample}"` : 'it printed nothing'}.`
		);
	}

	if (stderr.message || stderr.httpStatus || stderr.canonical) {
		return antigravityError(stderr.message ?? `Antigravity exited with code ${exit.code}.`, stderr);
	}

	if (stdoutLine && (SIGNED_OUT.test(stdoutLine) || USAGE_CAP.test(stdoutLine) || THROTTLED.test(stdoutLine))) {
		return antigravityError(stdoutLine);
	}

	return new LlmError(
		0,
		stdoutLine ? `Antigravity failed: ${stdoutLine}` : `Antigravity exited with code ${exit.code}.`
	);
}

function failedResult(result: ResultBody, stepError: string | null, exit: CliExit): LlmError | null {
	const failed =
		exit.code !== 0 ||
		result.status !== 'SUCCESS' ||
		(result.finished_reason !== undefined && result.finished_reason !== '');

	if (!failed) return null;

	const stderr = inspectStderr(exit.stderr);

	const reason =
		result.error ||
		stepError ||
		stderr.message ||
		(result.finished_reason
			? `Antigravity stopped (${result.finished_reason}).`
			: `Antigravity stopped (${result.status}).`);

	return antigravityError(reason, stderr, result.finished_reason);
}

interface SingleCallHandlers {
	onText?: (delta: string) => void;
	onThinking?: (delta: string) => void;
}

function flushUnstreamedTail(full: string, streamed: string, onText?: (delta: string) => void): string {
	const suffix = full.startsWith(streamed) ? full.slice(streamed.length) : '';

	if (suffix) onText?.(suffix);

	return full || streamed;
}

/**
 * Reads `stream-json` lines for a stateless `complete()` call: streams text and thinking deltas, records the
 * conversation ID for cleanup, and verifies the final `result` envelope.
 */
export class ReplyReader {
	conversationId: string | null = null;

	private streamed = '';
	private result: ResultBody | null = null;
	private stepError: string | null = null;
	private lastLine = '';

	constructor(private readonly handlers: SingleCallHandlers) {}

	readonly line = (raw: string): void => {
		this.lastLine = raw;

		const parsed = parseJsonObject(raw);

		if (parsed === null) return;

		const init = initEventSchema.safeParse(parsed);

		if (init.success) {
			this.conversationId = init.data.conversation_id || this.conversationId;

			return;
		}

		const step = stepUpdateSchema.safeParse(parsed);

		if (step.success) {
			const body = step.data.step_update;

			this.conversationId = body.conversation_id || this.conversationId;
			if (body.error_message) this.stepError = body.error_message;

			if (body.step_type === 'agent_response') {
				if (body.thinking_delta) this.handlers.onThinking?.(body.thinking_delta);

				if (body.text_delta) {
					this.streamed += body.text_delta;
					this.handlers.onText?.(body.text_delta);
				}
			}

			return;
		}

		const wrapped = resultEventSchema.safeParse(parsed);

		if (wrapped.success) {
			this.result = wrapped.data.result;
			this.conversationId = wrapped.data.result.conversation_id || this.conversationId;

			return;
		}

		const direct = resultBodySchema.safeParse(parsed);

		if (direct.success) {
			this.result = direct.data;
			this.conversationId = direct.data.conversation_id || this.conversationId;
		}
	};

	finish(onUsage: ((usage: TokenUsage) => void) | undefined, exit: CliExit): string {
		if (!this.result) throw missingResultError(this.lastLine, exit);

		const turnFailure = failedResult(this.result, this.stepError, exit);

		if (turnFailure) throw turnFailure;

		const finalText = this.result.response ?? '';

		if (!finalText.trim() && !this.streamed.trim()) throw new LlmError(0, 'Antigravity ended without a reply.');
		if (this.result.usage) onUsage?.(tokenUsage(this.result.usage));

		return flushUnstreamedTail(finalText, this.streamed, this.handlers.onText);
	}
}

/**
 * Reads `stream-json` lines for one prompt of an {@link AntigravityRun}: pairs each `agent_response` step's start and
 * `DONE` usage, streams reasoning and text deltas, flags non-protocol stdout lines as `error` events, and sums only
 * the current prompt's step usages so resumed `--conversation` turns never double-count prior turns.
 */
export class RunReader {
	conversationId: string | null = null;

	private readonly startedSteps = new Set<number>();
	private readonly finishedSteps = new Set<number>();
	private promptTokens: TokenUsage | undefined;
	private streamed = '';
	private result: ResultBody | null = null;
	private stepError: string | null = null;
	private lastLine = '';

	constructor(private readonly onEvent: (event: AgentEvent) => void) {}

	readonly line = (raw: string): void => {
		this.lastLine = raw;

		const parsed = parseJsonObject(raw);

		if (parsed === null) {
			this.onEvent({
				type: 'error',
				message: `Antigravity printed a line that is not JSON: "${quotedLine(raw, EVENT_QUOTED_CHARS)}"`
			});

			return;
		}

		const init = initEventSchema.safeParse(parsed);

		if (init.success) {
			this.conversationId = init.data.conversation_id || this.conversationId;
			this.onEvent({ type: 'activity' });

			return;
		}

		const step = stepUpdateSchema.safeParse(parsed);

		if (step.success) {
			this.handleStep(step.data.step_update);

			return;
		}

		const wrapped = resultEventSchema.safeParse(parsed);

		if (wrapped.success) {
			this.result = wrapped.data.result;
			this.conversationId = wrapped.data.result.conversation_id || this.conversationId;
			this.onEvent({ type: 'activity' });

			return;
		}

		const direct = resultBodySchema.safeParse(parsed);

		if (direct.success) {
			this.result = direct.data;
			this.conversationId = direct.data.conversation_id || this.conversationId;
			this.onEvent({ type: 'activity' });

			return;
		}

		this.onEvent({
			type: 'error',
			message: `Antigravity printed an unrecognized event: "${quotedLine(raw, EVENT_QUOTED_CHARS)}"`
		});
	};

	finish(exit: CliExit, isResumed: boolean): AgentReply {
		if (!this.result) {
			return { text: '', error: missingResultError(this.lastLine, exit), tokens: this.promptTokens };
		}

		const error = failedResult(this.result, this.stepError, exit);
		const fallbackTokens = !isResumed && this.result.usage ? tokenUsage(this.result.usage) : undefined;
		const tokens = this.promptTokens ?? fallbackTokens;

		if (error) return { text: '', error, tokens };

		const text = this.result.response ?? this.streamed;

		return { text, tokens };
	}

	private handleStep(body: z.infer<typeof stepUpdateSchema>['step_update']): void {
		this.conversationId = body.conversation_id || this.conversationId;
		if (body.error_message) this.stepError = body.error_message;

		if (body.step_type !== 'agent_response') {
			this.onEvent({ type: 'activity' });

			return;
		}

		const stepId = `step_${body.step_index}`;
		const partId = `part_${body.step_index}`;

		if (!this.startedSteps.has(body.step_index)) {
			this.startedSteps.add(body.step_index);
			this.onEvent({ type: 'step-start', step: stepId });
		}

		if (body.thinking_delta) this.onEvent({ type: 'reasoning', delta: body.thinking_delta, partId });

		if (body.text_delta) {
			this.streamed += body.text_delta;
			this.onEvent({ type: 'text', delta: body.text_delta, partId });
		}

		if (body.state === 'DONE' && body.usage && !this.finishedSteps.has(body.step_index)) {
			const stepTokens = tokenUsage(body.usage);

			this.finishedSteps.add(body.step_index);
			this.promptTokens = addTokenUsage(this.promptTokens, stepTokens);
			this.onEvent({ type: 'usage', usage: stepTokens, step: stepId });
		}
	}
}
