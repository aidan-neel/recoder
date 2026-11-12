import type { TokenUsage } from '@recoder/shared';
import { z } from 'zod';
import { LlmError, UsageLimitError } from '../../models/llm/errors';
import type { CliExit } from '../cli-stream';
import { quotedLine } from '../quoted-line';
import { ANTIGRAVITY_LOGIN, isConversationUuid } from './antigravity-process';

const QUOTED_CHARS = 300;

export const EVENT_QUOTED_CHARS = 120;

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

export type StepUpdate = z.infer<typeof stepUpdateSchema>['step_update'];

type ResultBody = z.infer<typeof resultBodySchema>;

/** Discriminated classification of one stdout line from `agy --output-format stream-json`. */
export type ClassifiedLine =
	| { kind: 'non-json' }
	| { kind: 'unknown' }
	| { kind: 'init'; conversationId: string }
	| { kind: 'step'; step: StepUpdate }
	| { kind: 'result'; result: ResultBody };

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
export function tokenUsage(usage: AgyUsage): TokenUsage {
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

function parseJsonObject(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

function classifyStreamLine(raw: string): ClassifiedLine {
	const parsed = parseJsonObject(raw);

	if (parsed === null) return { kind: 'non-json' };

	const init = initEventSchema.safeParse(parsed);

	if (init.success) return { kind: 'init', conversationId: init.data.conversation_id };

	const step = stepUpdateSchema.safeParse(parsed);

	if (step.success) return { kind: 'step', step: step.data.step_update };

	const wrapped = resultEventSchema.safeParse(parsed);

	if (wrapped.success) return { kind: 'result', result: wrapped.data.result };

	const direct = resultBodySchema.safeParse(parsed);

	if (direct.success) return { kind: 'result', result: direct.data };

	return { kind: 'unknown' };
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
	onConversation?: (id: string) => void;
}

function flushUnstreamedTail(responseText: string, streamed: string, onText?: (delta: string) => void): string {
	const finalText = responseText.trim() ? responseText : streamed;

	if (!finalText.trim()) throw new LlmError(0, 'Antigravity ended without a reply.');

	const suffix = finalText.startsWith(streamed) ? finalText.slice(streamed.length) : '';

	if (suffix) onText?.(suffix);

	return finalText;
}

/**
 * Reads `stream-json` lines for an Antigravity turn: streams text and thinking deltas, validates and reports UUID
 * conversation IDs as soon as they appear, and verifies the final `result` envelope.
 */
export class ReplyReader {
	private invalidConversationId: string | null = null;
	private readonly seenConversations = new Set<string>();
	private streamed = '';
	private result: ResultBody | null = null;
	private stepError: string | null = null;
	private lastLine = '';

	constructor(private readonly handlers: SingleCallHandlers) {}

	readonly line = (raw: string): void => {
		this.readLine(raw);
	};

	readLine(raw: string): ClassifiedLine {
		this.lastLine = raw;

		const classified = classifyStreamLine(raw);

		if (classified.kind === 'init') {
			this.recordInitConversationId(classified.conversationId);

			return classified;
		}

		if (classified.kind === 'step') {
			const body = classified.step;

			this.recordOptionalConversationId(body.conversation_id);
			if (body.error_message) this.stepError = body.error_message;

			if (body.step_type === 'agent_response') {
				if (body.thinking_delta) this.handlers.onThinking?.(body.thinking_delta);

				if (body.text_delta) {
					this.streamed += body.text_delta;
					this.handlers.onText?.(body.text_delta);
				}
			}

			return classified;
		}

		if (classified.kind === 'result') {
			this.result = classified.result;
			this.recordOptionalConversationId(classified.result.conversation_id);
		}

		return classified;
	}

	resultUsage(): TokenUsage | undefined {
		return this.result?.usage ? tokenUsage(this.result.usage) : undefined;
	}

	finish(onUsage: ((usage: TokenUsage) => void) | undefined, exit: CliExit): string {
		if (this.invalidConversationId !== null) {
			throw new LlmError(
				0,
				`Antigravity reported an invalid conversation ID: "${quotedLine(this.invalidConversationId, EVENT_QUOTED_CHARS)}".`
			);
		}

		if (!this.result) throw missingResultError(this.lastLine, exit);

		const turnFailure = failedResult(this.result, this.stepError, exit);

		if (turnFailure) throw turnFailure;

		const text = flushUnstreamedTail(this.result.response ?? '', this.streamed, this.handlers.onText);

		if (this.result.usage) onUsage?.(tokenUsage(this.result.usage));

		return text;
	}

	private recordOptionalConversationId(candidate: string | undefined): void {
		if (!candidate) return;

		this.recordInitConversationId(candidate);
	}

	private recordInitConversationId(candidate: string): void {
		if (!isConversationUuid(candidate)) {
			this.invalidConversationId ??= candidate;

			return;
		}

		if (this.seenConversations.has(candidate)) return;

		this.seenConversations.add(candidate);
		this.handlers.onConversation?.(candidate);
	}
}
