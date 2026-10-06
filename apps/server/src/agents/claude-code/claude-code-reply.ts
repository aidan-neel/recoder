import { z } from 'zod';
import type { TokenUsage } from '@recoder/shared';
import { LlmError } from '../../models/llm/errors';

const usageSchema = z.object({
	input_tokens: z.number().optional(),
	output_tokens: z.number().optional(),
	cache_creation_input_tokens: z.number().optional(),
	cache_read_input_tokens: z.number().optional(),
	output_tokens_details: z.object({ thinking_tokens: z.number().optional() }).optional()
});

/** The CLI's last line: the reply text, whether the call failed, and what it used. */
const resultSchema = z.object({
	type: z.literal('result'),
	subtype: z.string(),
	is_error: z.boolean(),
	result: z.string().optional(),
	api_error_status: z.number().nullable().optional(),
	usage: usageSchema.optional()
});

/** The SDK events the CLI forwards with `--include-partial-messages`; only text and thinking deltas matter. */
const deltaSchema = z.object({
	type: z.literal('stream_event'),
	event: z.object({
		type: z.literal('content_block_delta'),
		delta: z.object({ type: z.string(), text: z.string().optional(), thinking: z.string().optional() })
	})
});

/** An assistant message the CLI wrote in place of a reply when the API call failed. */
const apiErrorSchema = z.object({
	type: z.literal('assistant'),
	error: z.string(),
	message: z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })) })
});

type Result = z.infer<typeof resultSchema>;

/** Error codes the CLI tags a failed call with, as HTTP-like statuses so retries and the UI treat them as usual. */
const ERROR_STATUS: Record<string, number> = {
	authentication_failed: 401,
	oauth_org_not_allowed: 401,
	account_on_hold: 401,
	verification_required: 401,
	cloud_credential_error: 401,
	billing_error: 402,
	rate_limit: 429,
	overloaded: 529,
	server_error: 500,
	invalid_request: 400,
	model_not_found: 404
};

/** Wording of a failure that has no error code, for older CLIs and plain-text results. */
const SIGNED_OUT = /not logged in|failed to authenticate|please run \/login|invalid api key|oauth (?:token|session)/i;

const LIMIT =
	/usage limit|hit your [\w\s]*limit|limit reached|out of (?:usage|extra usage|credits)|resets? (?:at|in)\b/i;

/**
 * The failure as an `LlmError`. Signed out and out of usage get messages that say what to do: the first names
 * the command to run, the second keeps the CLI's own wording because it carries the reset time. A reply cut at
 * the output limit says "truncated" so it is not retried.
 */
export function claudeCodeError(text: string, code: string | null, apiStatus: number | null): LlmError {
	const status = (code && ERROR_STATUS[code]) || (SIGNED_OUT.test(text) ? 401 : LIMIT.test(text) ? 429 : apiStatus);

	if (status === 401) {
		return new LlmError(
			401,
			`Claude Code is not signed in (${text}). Run "claude auth login" in a terminal, then retry.`
		);
	}

	if (code === 'max_output_tokens') return new LlmError(0, 'Claude Code reply was truncated at its output limit.');

	return new LlmError(status ?? 0, text || 'Claude Code request failed.');
}

/**
 * The CLI counts cache reads and writes apart from `input_tokens`; Recoder's usage holds them as breakdowns, so
 * they are added back in. `output_tokens` already includes thinking.
 */
function tokenUsage(usage: z.infer<typeof usageSchema>): TokenUsage {
	const cachedInputTokens = usage.cache_read_input_tokens ?? 0;
	const cacheWriteInputTokens = usage.cache_creation_input_tokens ?? 0;
	const inputTokens = (usage.input_tokens ?? 0) + cachedInputTokens + cacheWriteInputTokens;
	const outputTokens = usage.output_tokens ?? 0;

	return {
		inputTokens,
		outputTokens,
		totalTokens: inputTokens + outputTokens,
		cachedInputTokens,
		cacheWriteInputTokens,
		reasoningOutputTokens: usage.output_tokens_details?.thinking_tokens ?? null
	};
}

function parseLine(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

/** Where the reader sends streamed text and thinking as it arrives. */
export interface ReplyHandlers {
	onText?: (delta: string) => void;
	onThinking?: (delta: string) => void;
}

/**
 * Reads the CLI's `stream-json` output one line at a time: forwards text and thinking deltas, keeps the error
 * code of a failed API call, and holds the final `result` line, which is authoritative for the text and usage.
 */
export class ReplyReader {
	private streamed = '';
	private code: string | null = null;
	private result: Result | null = null;

	constructor(private readonly handlers: ReplyHandlers) {}

	line(line: string): void {
		const value = parseLine(line);
		const delta = deltaSchema.safeParse(value);

		if (delta.success) return this.delta(delta.data.event.delta);

		const failed = apiErrorSchema.safeParse(value);

		if (failed.success) {
			this.code = failed.data.error;

			return;
		}

		const result = resultSchema.safeParse(value);

		if (result.success) this.result = result.data;
	}

	/** The reply text, after any of it the stream had not delivered is sent. Throws when the call failed. */
	finish(onUsage: ((usage: TokenUsage) => void) | undefined, exit: { code: number; stderr: string }): string {
		const result = this.result;

		if (!result) {
			const reason = exit.stderr.trim().split('\n').at(-1);

			throw new LlmError(0, reason ? `Claude Code failed: ${reason}` : `Claude Code exited with code ${exit.code}.`);
		}

		if (result.usage) onUsage?.(tokenUsage(result.usage));

		const text = result.result ?? '';

		if (result.is_error || result.subtype !== 'success') {
			throw claudeCodeError(
				text || `Claude Code stopped (${result.subtype}).`,
				this.code,
				result.api_error_status ?? null
			);
		}

		if (text.startsWith(this.streamed) && text.length > this.streamed.length) {
			this.handlers.onText?.(text.slice(this.streamed.length));
		}

		return text;
	}

	private delta(delta: { type: string; text?: string; thinking?: string }): void {
		if (delta.type === 'text_delta' && delta.text) {
			this.streamed += delta.text;
			this.handlers.onText?.(delta.text);
		}

		if (delta.type === 'thinking_delta' && delta.thinking) this.handlers.onThinking?.(delta.thinking);
	}
}
