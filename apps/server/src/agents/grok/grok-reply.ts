import { z } from 'zod';
import type { TokenUsage } from '@recoder/shared';
import { LlmError, UsageLimitError } from '../../models/llm/errors';
import type { CliExit } from '../cli-stream';
import { quotedLine } from '../quoted-line';

/**
 * Token counters of a `streaming-messages-json` usage object. Grok reports the same four disjoint buckets as the
 * Anthropic Messages API it mirrors: `input_tokens` is the uncached part, `cache_read_input_tokens` and
 * `cache_creation_input_tokens` are separate, so the billed input is their sum. `server_tool_use` counts the
 * server-side tools (web search) the run used; Recoder does not bill them separately, so they are only parsed
 * past. Extra fields the docs warn may be present are ignored.
 */
export const usageSchema = z.object({
	output_tokens_details: z.object({ thinking_tokens: z.number().optional() }).optional(),
	cache_read_input_tokens: z.number().optional(),
	cache_creation_input_tokens: z.number().optional(),
	input_tokens: z.number().optional(),
	output_tokens: z.number().optional(),
	server_tool_use: z.object({ web_search_requests: z.number().optional() }).optional()
});

type GrokUsage = z.infer<typeof usageSchema>;

/** The terminal `result` line of a run, the only complete answer the stream guarantees. */
export const resultSchema = z.object({
	type: z.literal('result'),
	subtype: z.string(),
	is_error: z.boolean(),
	result: z.string().optional(),
	stop_reason: z.string().optional(),
	usage: usageSchema.optional(),
	errors: z.array(z.string()).optional()
});

type GrokResult = z.infer<typeof resultSchema>;

/** The `system/init` line, which reports how the CLI authenticated (`oauth`, `user`, …) before the first message. */
const initSchema = z.object({
	type: z.literal('system'),
	subtype: z.literal('init'),
	apiKeySource: z.string().optional()
});

/**
 * A `content_block_delta` event: streamed text and thinking arrive this way with `--include-partial-messages`.
 * `index` is the content block the delta belongs to; Recoder only reads text and thinking, so tool-call blocks
 * match the schema and are ignored by the delta's `type`.
 */
export const contentBlockDeltaSchema = z.object({
	type: z.literal('content_block_delta'),
	index: z.number(),
	delta: z.object({
		type: z.string(),
		thinking: z.string().optional(),
		text: z.string().optional()
	})
});

/** A `stream_event` wrapping {@link contentBlockDeltaSchema}. */
const deltaSchema = z.object({
	type: z.literal('stream_event'),
	event: contentBlockDeltaSchema
});

/** One JSON object per stdout line; null for anything else, which the caller reports instead of guessing. */
export function parseLine(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

/**
 * The CLI counts cache reads and writes apart from `input_tokens`; Recoder's usage holds them as breakdowns, so
 * they are added back in. `output_tokens` already includes thinking.
 */
export function tokenUsage(usage: GrokUsage): TokenUsage {
	const read = usage.cache_read_input_tokens;
	const written = usage.cache_creation_input_tokens;
	const billed = usage.input_tokens;

	const inputTokens = billed === undefined ? null : billed + (read ?? 0) + (written ?? 0);
	const outputTokens = usage.output_tokens ?? null;

	return {
		reasoningOutputTokens: usage.output_tokens_details?.thinking_tokens ?? null,
		cacheWriteInputTokens: written ?? null,
		cachedInputTokens: read ?? null,
		totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
		outputTokens,
		inputTokens
	};
}

/** Signed-out and rate-limit wordings seen in CLI errors and the result line's `result`/`errors` text. */
const SIGNED_OUT =
	/not logged in|log ?in required|please (?:log|sign) ?in|unauthori[sz]ed|authentication|invalid api key/i;

const LIMIT = /usage limit|rate.?limit|quota|too many requests|insufficient|credit|billing/i;

/** Longest stretch of a CLI error line quoted in a message. */
const QUOTED_CHARS = 120;

/** The quoted tail of a failed run's text, cut to the message shape the review shows. */
function errorLine(text: string): string {
	const line = text.trim().split('\n').at(-1) ?? '';

	return quotedLine(line, QUOTED_CHARS);
}

/**
 * A Grok failure as an `LlmError`: signed-out and usage-limit wordings keep their HTTP meaning so the UI can
 * offer sign-in or a retry-later, a max-turns or max-token stop says which limit cut the run, and anything else
 * quotes its last line without echoing credentials.
 */
export function grokError(text: string, stopReason?: string): LlmError {
	const quoted = errorLine(text);

	if (SIGNED_OUT.test(text)) return new LlmError(401, `Grok Build is signed out: ${quoted}. Sign in with: grok login`);
	if (LIMIT.test(text)) return new UsageLimitError(429, `Grok Build hit its usage limit: ${quoted}`);
	if (stopReason === 'max_tokens') return new LlmError(0, 'Grok Build reply was cut at its output limit.');

	return new LlmError(0, `Grok Build failed: ${quoted}`);
}

/** What a `complete()` call streams and finishes with; `prompt()` runs use {@link RunReader} instead. */
export interface ReplyHandlers {
	onText?: (delta: string) => void;
	onThinking?: (delta: string) => void;
	onApiKeySource?: (source: string) => void;
}

/**
 * Reads one `complete()` process's `streaming-messages-json` output: `system/init` reports the auth source,
 * `stream_event` deltas stream text and thinking to the handlers, and the terminal `result` line is the answer
 * and its usage. A line that is not JSON or not one of those shapes is ignored — the docs warn the stream is not
 * exhaustive — but a run that ends without a `result` fails in {@link finish}.
 */
export class ReplyReader {
	private streamed = '';
	private result: GrokResult | null = null;
	private apiKeySourceReported = false;
	private lastLine = '';

	constructor(private readonly handlers: ReplyHandlers) {}

	readonly line = (line: string): void => {
		if (line.trim()) this.lastLine = line;

		const value = parseLine(line);

		if (value === null) return;

		const delta = deltaSchema.safeParse(value);

		if (delta.success) return this.streamedDelta(delta.data);

		const init = initSchema.safeParse(value);

		if (init.success && init.data.apiKeySource && !this.apiKeySourceReported) {
			this.apiKeySourceReported = true;
			this.handlers.onApiKeySource?.(init.data.apiKeySource);
		}

		const result = resultSchema.safeParse(value);

		if (result.success) this.result = result.data;
	};

	private streamedDelta(delta: z.infer<typeof deltaSchema>): void {
		const inner = delta.event.delta;

		if (inner.type === 'text_delta' && inner.text) {
			this.streamed += inner.text;
			this.handlers.onText?.(inner.text);
		} else if (inner.type === 'thinking_delta' && inner.thinking) {
			this.handlers.onThinking?.(inner.thinking);
		}
	}

	/**
	 * The reply once the process has exited: the `result` line's text, reporting usage and any auth source seen.
	 * Throws an `LlmError` when the run errored, was cut off, or never produced a `result`.
	 */
	finish(onUsage: ((usage: TokenUsage) => void) | undefined, exit: CliExit): string {
		const result = this.result;

		if (!result) {
			if (exit.code !== 0) throw new LlmError(0, `Grok Build failed: ${errorLine(exit.stderr) || `exit ${exit.code}`}`);

			throw new LlmError(
				0,
				`Grok Build output could not be parsed${this.lastLine ? `: the last line was ${quotedLine(this.lastLine, QUOTED_CHARS)}` : ': it printed nothing'}.`
			);
		}

		if (result.is_error || result.subtype !== 'success') {
			throw grokError(
				result.result ?? result.errors?.join('\n') ?? `Grok Build stopped (${result.subtype}).`,
				result.stop_reason
			);
		}

		if (result.usage) onUsage?.(tokenUsage(result.usage));

		const text = result.result ?? '';
		const tail = text.startsWith(this.streamed) ? text.slice(this.streamed.length) : text;

		if (tail) this.handlers.onText?.(tail);

		return text;
	}
}
