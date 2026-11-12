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
const resultSchema = z.object({
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

/** Signed-out wordings seen in CLI errors, `grok models` output and the result line's `result`/`errors` text. */
export const SIGNED_OUT =
	/not logged in|log ?in required|please (?:log|sign) ?in|unauthori[sz]ed|authentication|invalid api key/i;

/**
 * A request throttle that lifts within minutes: retried with back-off, never reported as out of usage. It is tested
 * after {@link USAGE_CAP} and {@link SPENT_CREDIT}, since a spent plan is often worded as a rate limit too ("Rate
 * limit exceeded: monthly quota exhausted") and retrying it starts a new process each time for nothing.
 */
const THROTTLE = /rate.?limit|too many requests|throttl/i;

/** The plan's usage cap or quota, which lasts hours. */
const USAGE_CAP = /usage limit|quota/i;

/**
 * Spent credit or billing: the account cannot pay for more calls. xAI's own wording is that the team "has either
 * used all available credits or reached its monthly spending limit".
 */
const SPENT_CREDIT = /insufficient credit|out of credits|available credits|spending limit|billing/i;

/** Longest stretch of a CLI error line quoted in a message. */
const QUOTED_CHARS = 120;

/** One line of a failed run's text, redacted and cut to the message shape the review shows. */
function quoted(line: string): string {
	return quotedLine(line, QUOTED_CHARS);
}

/** One wording family of a failed run: the pattern that spots it, and the error it becomes for the line it matched. */
interface FailureWording {
	pattern: RegExp;
	toError: (line: string) => LlmError;
}

/** The wording families, most lasting cause first: the first one a line matches names the failure. */
const FAILURE_WORDINGS: FailureWording[] = [
	{
		pattern: SIGNED_OUT,
		toError: (line) => new LlmError(401, `Grok Build is signed out: ${quoted(line)}. Sign in with: grok login`)
	},
	{
		pattern: SPENT_CREDIT,
		toError: (line) => new UsageLimitError(402, `Grok Build is out of credit: ${quoted(line)}`)
	},
	{
		pattern: USAGE_CAP,
		toError: (line) => new UsageLimitError(429, `Grok Build hit its usage limit: ${quoted(line)}`)
	},
	{
		pattern: THROTTLE,
		toError: (line) => new LlmError(429, `Grok Build is rate limited: ${quoted(line)}`)
	}
];

/**
 * A Grok failure as an `LlmError`: signed-out keeps its 401 and sign-in hint, spent credit is a `UsageLimitError`
 * 402 and a usage cap a `UsageLimitError` 429 even when the text also calls it a rate limit, a plain throttle is a
 * retryable 429, a max-turns or max-token stop says which limit cut the run, and anything else quotes its last
 * line. The message always quotes the line that named the failure, never a later one, and never a credential.
 */
export function grokError(text: string, stopReason?: string): LlmError {
	const lines = text.trim().split('\n');

	for (const wording of FAILURE_WORDINGS) {
		const line = lines.find((candidate) => wording.pattern.test(candidate));

		if (line !== undefined) return wording.toError(line);
	}

	if (stopReason === 'max_tokens') return new LlmError(0, 'Grok Build reply was cut at its output limit.');

	return new LlmError(0, `Grok Build failed: ${quoted(lines.at(-1) ?? '')}`);
}

/**
 * The error of a run that printed no `result` line. A non-zero exit failed before it could answer, so its whole
 * stderr goes through {@link grokError}: sign-in and limit wordings keep their meaning on any line. A clean exit
 * printed a stream this reader could not use, so the error quotes the last line it saw the same way.
 */
function noResultError(exit: CliExit, lastLine: string): LlmError {
	if (exit.code === 0) {
		return new LlmError(
			0,
			`Grok Build output could not be parsed${lastLine ? `: the last line was ${quoted(lastLine)}` : ': it printed nothing'}.`
		);
	}

	return grokError(exit.stderr.trim() || `exit ${exit.code}`);
}

/** The error of a `result` line that reports failure: its text or errors through {@link grokError}, with its stop reason. */
function failedResult(result: GrokResult): LlmError {
	return grokError(
		result.result ?? result.errors?.join('\n') ?? `Grok Build stopped (${result.subtype}).`,
		result.stop_reason
	);
}

/** Where a `complete()` call streams and finishes with; `prompt()` runs use {@link RunReader} instead. */
interface ReplyHandlers {
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

		if (!result) throw noResultError(exit, this.lastLine);
		if (result.is_error || result.subtype !== 'success') throw failedResult(result);

		if (result.usage) onUsage?.(tokenUsage(result.usage));

		const text = result.result ?? '';
		const tail = text.startsWith(this.streamed) ? text.slice(this.streamed.length) : text;

		if (tail) this.handlers.onText?.(tail);

		return text;
	}
}
