import type { TokenUsage } from '@recoder/shared';
import { z } from 'zod';
import { LlmError, UsageLimitError } from '../../models/llm/errors';
import type { CliExit } from '../cli-stream';
import { quotedLine } from '../quoted-line';

export const CURSOR_LOGIN = 'cursor-agent login';

const SIGNED_OUT = /not (?:logged|signed) in|authentication required|unauthorized|please (?:log|sign) ?in/i;

const LIMIT =
	/usage limit|plan (?:usage |rate )?limit|monthly limit|quota (?:exceeded|reached)|exceeded (?:your |the )?quota|out of (?:usage|credits)|insufficient (?:credits?|funds|balance)|spending limit/i;

const THROTTLE = /rate.?limit|too many requests/i;

/** Longest stretch of a CLI line quoted in an error or event. */
const QUOTED_CHARS = 300;

/**
 * Token counts as Cursor reports them: snake_case inside a nested `usage` object (the older shape) or camelCase,
 * either nested or at the top level of the `result` event. Every field is optional; unknown ones are dropped.
 */
const usageFields = {
	input_tokens: z.number().optional(),
	output_tokens: z.number().optional(),
	cached_input_tokens: z.number().optional(),
	cache_creation_input_tokens: z.number().optional(),
	inputTokens: z.number().optional(),
	outputTokens: z.number().optional(),
	cachedInputTokens: z.number().optional(),
	cacheReadTokens: z.number().optional(),
	cacheReadInputTokens: z.number().optional(),
	cacheWriteTokens: z.number().optional(),
	cacheWriteInputTokens: z.number().optional()
};

const usageSchema = z.object(usageFields);

/** The terminal `result` event: the answer, whether it failed, the session and what the run used. */
const resultSchema = z.object({
	type: z.literal('result'),
	subtype: z.string().optional(),
	is_error: z.boolean().optional(),
	result: z.string().optional(),
	session_id: z.string().optional(),
	usage: usageSchema.optional(),
	...usageFields
});

export type CursorResult = z.infer<typeof resultSchema>;

/** The first `system`/`init` event: the session to resume and what pays for the call. */
const initSchema = z.object({
	type: z.literal('system'),
	subtype: z.literal('init'),
	session_id: z.string().optional(),
	apiKeySource: z.string().optional()
});

/** An `assistant` event: a streaming delta (`timestamp_ms`, no `model_call_id`) or a complete message. */
const contentBlockSchema = z.object({ type: z.string().optional(), text: z.string().optional() });

const assistantSchema = z.object({
	type: z.literal('assistant'),
	timestamp_ms: z.number().optional(),
	model_call_id: z.string().optional(),
	message: z
		.object({
			role: z.string().optional(),
			content: z.union([z.string(), z.array(contentBlockSchema)]).optional()
		})
		.optional()
});

/** A `thinking` event: reasoning text arrives as deltas; `completed` repeats it whole. */
const thinkingSchema = z.object({
	type: z.literal('thinking'),
	subtype: z.string().optional(),
	delta: z.string().optional(),
	text: z.string().optional(),
	thinking: z.string().optional(),
	content: z.string().optional()
});

/** A `step_finish` event: one model call's tokens, the fallback when `result` carries no usage. */
const stepTokensSchema = z.object({
	input: z.number().optional(),
	output: z.number().optional(),
	cache: z.object({ read: z.number().optional(), write: z.number().optional() }).optional()
});

const stepFinishSchema = z.object({
	type: z.literal('step_finish'),
	part: z.object({ tokens: stepTokensSchema.optional() }).optional()
});

/** A `system`/`error` or top-level `error` event: something the run survives but should know about. */
const errorBodySchema = z.object({
	message: z.string().optional(),
	error: z.string().optional(),
	detail: z.string().optional()
});

const protocolErrorSchema = z.object({
	type: z.string(),
	subtype: z.string().optional(),
	error: z.unknown().optional(),
	detail: z.unknown().optional(),
	message: z.unknown().optional()
});

/** The `status --format json` answer, tolerant of the field names versions have used. */
const statusSchema = z.object({
	authenticated: z.boolean().optional(),
	loggedIn: z.boolean().optional(),
	signedIn: z.boolean().optional(),
	isAuthenticated: z.boolean().optional(),
	email: z.string().optional(),
	account: z.unknown().optional()
});

type Assistant = z.infer<typeof assistantSchema>;

type StepTokens = z.infer<typeof stepTokensSchema>;

type AssistantContent = string | z.infer<typeof contentBlockSchema>[] | undefined;

/** Where the reader sends what it parses: deltas, the terminal result and signs of trouble. */
export interface CursorHandlers {
	text?: (delta: string, partId: string) => void;
	reasoning?: (delta: string, partId: string) => void;
	/** The `result` event arrived; the process may be stopped now. */
	result?: () => void;
	/** A line that is not JSON, or a protocol error the run survives. */
	problem?: (message: string) => void;
	/** What pays for the call, from the init event's `apiKeySource`. */
	apiKeySource?: (source: string) => void;
}

function parseJson(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

/** The text blocks of an assistant message's content, joined. */
function assistantText(content: AssistantContent): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';

	return content
		.filter((block) => !block.type || block.type === 'text')
		.map((block) => block.text ?? '')
		.join('');
}

/** The first defined number of the candidates, or null when none is a number. */
function firstNumber(...values: (number | undefined)[]): number | null {
	return values.find((value) => value !== undefined) ?? null;
}

/** Recoder's usage from Cursor's reported counts; cached and cache-write counts are breakdowns, not added in. */
function tokenUsage(fields: {
	inputTokens: number | null;
	outputTokens: number | null;
	cachedInputTokens: number | null;
	cacheWriteInputTokens: number | null;
	reasoningOutputTokens?: number | null;
}): TokenUsage {
	const { inputTokens, outputTokens } = fields;

	return {
		inputTokens,
		outputTokens,
		totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
		cachedInputTokens: fields.cachedInputTokens,
		cacheWriteInputTokens: fields.cacheWriteInputTokens,
		reasoningOutputTokens: fields.reasoningOutputTokens ?? null
	};
}

/**
 * What a signed-out call tells the user. Recoder runs the CLI under its own config folder but links the user's
 * `auth.json` in, so a `cursor-agent login` sign-in does reach a run — unless the CLI keeps that sign-in outside
 * the file, as on macOS, where its session lives in the Keychain. The message names `CURSOR_API_KEY` first, the
 * sign-in that always reaches a run.
 */
export const SIGNED_OUT_FIX = `Set CURSOR_API_KEY, or sign in with \`${CURSOR_LOGIN}\` (its auth.json reaches a run; a Keychain sign-in on macOS may not).`;

/**
 * The failure a `cursor-agent` call maps to: signed out is a 401, a spent plan a usage cap, a throttle a 429.
 * The patterns match the CLI's raw text, but only {@link quotedLine}'s redacted, capped form of it reaches a
 * message.
 */
function cursorError(text: string): LlmError {
	if (SIGNED_OUT.test(text)) return new LlmError(401, `Cursor is signed out. ${SIGNED_OUT_FIX}`);

	const quoted = quotedLine(text, QUOTED_CHARS);

	if (LIMIT.test(text)) return new UsageLimitError(429, quoted);
	if (THROTTLE.test(text)) return new LlmError(429, quoted);

	return new LlmError(0, quoted);
}

/** Whether the terminal result reports a failed turn. */
function resultFailed(result: CursorResult): boolean {
	return result.is_error === true || (result.subtype !== undefined && result.subtype !== 'success');
}

/**
 * Reads the `stream-json` output of one `cursor-agent -p` call line by line: init gives the session and payer,
 * assistant deltas and complete messages give the streamed text and the final answer, thinking gives reasoning,
 * `step_finish` counts tokens when `result` has none, and `result` ends the call. Tool calls are not read here:
 * they reach Recoder over MCP, which reports them.
 */
export class CursorReader {
	/** The chat id later prompts resume, once the CLI names it. */
	sessionId: string | null = null;

	private result: CursorResult | null = null;
	private errorText: string | null = null;
	private lastMessage = '';
	private streamed = '';
	private lastRaw = '';
	private messageIndex = 1;
	private stepTokens: { input: number; output: number; cacheRead: number; cacheWrite: number; seen: boolean } = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		seen: false
	};

	constructor(private readonly handlers: CursorHandlers) {}

	/** Whether the terminal `result` event arrived. */
	get finished(): boolean {
		return this.result !== null;
	}

	readonly line = (raw: string): void => {
		this.lastRaw = raw;

		const value = parseJson(raw);

		if (value === null) {
			this.handlers.problem?.(`Cursor printed a line that is not JSON: "${quotedLine(raw, 120)}"`);

			return;
		}

		this.event(value);
	};

	/**
	 * The prompt's answer: the last complete assistant message (what the model finally said, without the
	 * narration before its tool calls), else the `result` text, else what streamed.
	 */
	answer(): string {
		return this.lastMessage || this.result?.result || this.streamed;
	}

	/**
	 * What the call used. `result` usage reads as the session's running total when the CLI reports one; the
	 * `step_finish` sum is this prompt's own. `cumulative` tells the caller which it got.
	 */
	usage(): { usage: TokenUsage; cumulative: boolean } | null {
		const fromResult = this.resultUsage();

		if (fromResult) return { usage: fromResult, cumulative: true };
		if (this.stepTokens.seen)
			return {
				usage: tokenUsage({
					inputTokens: this.stepTokens.input,
					outputTokens: this.stepTokens.output,
					cachedInputTokens: this.stepTokens.cacheRead,
					cacheWriteInputTokens: this.stepTokens.cacheWrite
				}),
				cumulative: false
			};

		return null;
	}

	/** The error of a call that failed or printed no result, or null when it answered. */
	failure(exit: CliExit): LlmError | null {
		const result = this.result;

		if (result) {
			if (!resultFailed(result)) return null;

			return cursorError(result.result || this.errorText || `Cursor stopped (${result.subtype ?? 'unknown'}).`);
		}

		return this.unfinished(exit);
	}

	private event(value: unknown): void {
		const init = initSchema.safeParse(value);

		if (init.success) return this.init(init.data);

		const result = resultSchema.safeParse(value);

		if (result.success) return this.finish(result.data);

		const assistant = assistantSchema.safeParse(value);

		if (assistant.success) return this.assistant(assistant.data);

		const thinking = thinkingSchema.safeParse(value);

		if (thinking.success) return this.thinking(thinking.data);

		const step = stepFinishSchema.safeParse(value);

		if (step.success) return this.stepFinished(step.data.part?.tokens);

		const error = protocolErrorSchema.safeParse(value);

		if (error.success && (error.data.type === 'error' || error.data.subtype === 'error'))
			this.protocolError(error.data);
	}

	private init(event: z.infer<typeof initSchema>): void {
		this.sessionId = event.session_id ?? this.sessionId;
		if (event.apiKeySource) this.handlers.apiKeySource?.(event.apiKeySource);
	}

	private finish(result: CursorResult): void {
		this.result = result;
		this.sessionId = result.session_id ?? this.sessionId;
		this.handlers.result?.();
	}

	private assistant(event: Assistant): void {
		const text = assistantText(event.message?.content);
		const delta = event.timestamp_ms !== undefined && event.model_call_id === undefined;

		if (delta) {
			if (text) {
				this.streamed += text;
				this.handlers.text?.(text, `cursor_${this.messageIndex}`);
			}
		} else {
			if (text) this.lastMessage = text;
			this.messageIndex++;
		}
	}

	private thinking(event: z.infer<typeof thinkingSchema>): void {
		const delta = event.delta ?? event.text ?? event.thinking ?? event.content ?? '';

		if (delta && (event.subtype === undefined || event.subtype === 'delta'))
			this.handlers.reasoning?.(delta, `cursor_${this.messageIndex}`);
	}

	private stepFinished(tokens: StepTokens | undefined): void {
		if (tokens) {
			this.stepTokens.seen = true;
			this.stepTokens.input += tokens.input ?? 0;
			this.stepTokens.output += tokens.output ?? 0;
			this.stepTokens.cacheRead += tokens.cache?.read ?? 0;
			this.stepTokens.cacheWrite += tokens.cache?.write ?? 0;
		}
	}

	private protocolError(event: z.infer<typeof protocolErrorSchema>): void {
		this.errorText = errorText(event) ?? this.errorText;
		this.handlers.problem?.(`Cursor reported an error: ${quotedLine(this.errorText ?? 'unknown', QUOTED_CHARS)}`);
	}

	/**
	 * A call that printed no `result`: one that exited cleanly printed something this reader cannot use, so the
	 * error quotes its last output line (or stderr line); one that failed quotes its last stderr line.
	 */
	private unfinished(exit: CliExit): LlmError {
		const stdout = lastLine(this.lastRaw);
		const stderr = lastLine(exit.stderr);

		if (exit.code === 0) {
			const line = stdout ?? stderr;

			return new LlmError(
				0,
				`Cursor output could not be parsed: ${line ? `the last line was "${quotedLine(line, QUOTED_CHARS)}"` : 'it printed nothing'}.`
			);
		}

		return cursorError(stderr ?? stdout ?? `Cursor exited with code ${exit.code}.`);
	}

	/** The usage the `result` event reported, merged from its nested `usage` and its top-level fields. */
	private resultUsage(): TokenUsage | null {
		const result = this.result;

		if (!result) return null;

		const nested = result.usage ?? {};
		const inputTokens = firstNumber(nested.input_tokens, nested.inputTokens, result.input_tokens, result.inputTokens);

		const outputTokens = firstNumber(
			nested.output_tokens,
			nested.outputTokens,
			result.output_tokens,
			result.outputTokens
		);

		const cachedInputTokens = firstNumber(
			nested.cached_input_tokens,
			nested.cachedInputTokens,
			nested.cacheReadTokens,
			nested.cacheReadInputTokens,
			result.cachedInputTokens,
			result.cacheReadTokens
		);

		const cacheWriteInputTokens = firstNumber(
			nested.cache_creation_input_tokens,
			nested.cacheWriteTokens,
			nested.cacheWriteInputTokens,
			result.cacheWriteTokens,
			result.cacheWriteInputTokens,
			result.cache_creation_input_tokens
		);

		if (inputTokens === null && outputTokens === null && cachedInputTokens === null && cacheWriteInputTokens === null)
			return null;

		return tokenUsage({ inputTokens, outputTokens, cachedInputTokens, cacheWriteInputTokens });
	}
}

/** The last line of `text`, trimmed; quoting is the caller's job. */
function lastLine(text: string): string | undefined {
	const trimmed = text.trim();
	const line = trimmed.slice(trimmed.lastIndexOf('\n') + 1).trim();

	return line || undefined;
}

/** The message an error event carries, from its `error`, `detail` or `message` field, string or object. */
function errorText(event: z.infer<typeof protocolErrorSchema>): string | null {
	for (const field of [event.error, event.detail, event.message]) {
		if (typeof field === 'string' && field) return field;

		const body = errorBodySchema.safeParse(field);

		if (body.success) {
			const text = body.data.message ?? body.data.error ?? body.data.detail;

			if (text) return text;
		}
	}

	return null;
}

/**
 * The sign-in state `cursor-agent status --format json` reports; text output is the fallback. Signed-out
 * phrases hold signed-in words ("not logged in", "unauthenticated"), so they are tested first.
 */
export function signInState(code: number, stdout: string): boolean | null {
	const status = statusSchema.safeParse(parseJson(stdout));

	if (status.success) {
		const found =
			status.data.authenticated ?? status.data.loggedIn ?? status.data.signedIn ?? status.data.isAuthenticated;

		if (found !== undefined) return found;
		if (status.data.email !== undefined || status.data.account !== undefined) return true;
	}

	if (/not (?:logged|signed) in|signed out|unauthenticated|not authenticated|authentication required/i.test(stdout))
		return false;
	if (/logged in|authenticated|signed in/i.test(stdout)) return true;

	return code === 0 ? null : false;
}
