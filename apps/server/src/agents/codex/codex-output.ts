import type { TokenUsage } from '@recoder/shared';
import { z } from 'zod';
import { LlmError, UsageLimitError } from '../../models/llm/errors';
import { parseJson, type CliExit } from '../cli-stream';
import type { AgentEvent } from '../contract';
import { quotedLine } from '../quoted-line';

export const CODEX_LOGIN = 'codex login';

/** Longest stretch of the CLI's output quoted in an error or event. */
const QUOTED_CHARS = 300;

/** A session id as `thread.started` gives it: a UUID, which is all `codex exec resume` and `codex delete` are passed. */
const sessionIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const countSchema = z.number().int().nonnegative();

const usageSchema = z.object({
	input_tokens: countSchema,
	cached_input_tokens: countSchema,
	cache_write_input_tokens: countSchema.optional(),
	output_tokens: countSchema,
	reasoning_output_tokens: countSchema
});

/** An item: an agent message or reasoning summary carries `text`, an error item `message`. */
const itemSchema = z.object({
	id: z.string(),
	type: z.string(),
	text: z.string().optional(),
	message: z.string().optional()
});

const errorSchema = z.object({ message: z.string() });

/** The JSONL events `codex exec --json` prints, as far as Recoder reads them. */
const eventSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('thread.started'), thread_id: sessionIdSchema }),
	z.object({ type: z.literal('turn.started') }),
	z.object({ type: z.literal('turn.completed'), usage: usageSchema }),
	z.object({ type: z.literal('turn.failed'), error: errorSchema }),
	z.object({ type: z.literal('item.started'), item: itemSchema }),
	z.object({ type: z.literal('item.updated'), item: itemSchema }),
	z.object({ type: z.literal('item.completed'), item: itemSchema }),
	z.object({ type: z.literal('error'), message: z.string() })
]);

type CodexEvent = z.infer<typeof eventSchema>;

type CodexItem = z.infer<typeof itemSchema>;

const USAGE_KEYS = [
	'input_tokens',
	'cached_input_tokens',
	'cache_write_input_tokens',
	'output_tokens',
	'reasoning_output_tokens'
] as const;

/** A session's running usage total, as the CLI's `turn.completed` reports it. */
export type SessionUsage = z.infer<typeof usageSchema>;

/** Words that mean the plan's usage is spent: it resets in hours, so it is a usage cap, not a throttle. */
const USAGE_LIMIT = /usage limit|purchase more credits|upgrade to (?:pro|plus)|quota/i;

const SIGNED_OUT =
	/not logged in|not signed in|please (?:log|sign) ?in|codex login|unauthori[sz]ed|\b401\b|(?:token|session) (?:has )?(?:expired|been revoked)|refresh token/i;

const THROTTLE = /rate limit|too many requests|\b429\b/i;

const OVERLOADED = /overloaded|\b529\b|at capacity|server is busy/i;

/**
 * The error a failed call raises, from the CLI's own message: a spent plan is a usage cap (its message carries the
 * reset time), signed out a 401 that names the sign-in command, a throttle or an overload a retryable status.
 */
function codexError(message: string): LlmError {
	const quoted = quotedLine(message.trim(), QUOTED_CHARS);

	if (USAGE_LIMIT.test(quoted)) return new UsageLimitError(429, quoted);
	if (SIGNED_OUT.test(quoted)) return new LlmError(401, `Codex is signed out. Run: ${CODEX_LOGIN}`);
	if (THROTTLE.test(quoted)) return new LlmError(429, quoted);

	return new LlmError(OVERLOADED.test(quoted) ? 529 : 0, quoted);
}

/** The last non-empty line of stderr that is not a log line of the CLI's own (`2026-…Z ERROR rmcp…`). */
function stderrLine(stderr: string): string | undefined {
	return stderr
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line && !/^\d{4}-\d\d-\d\dT[\d:.]+Z\s+[A-Z]+\s/.test(line))
		.at(-1);
}

/** The counts of one prompt. The CLI reports the session's running total, so the total before it is taken off. */
function promptUsage(total: SessionUsage, before: SessionUsage | null): TokenUsage {
	const less = (key: keyof SessionUsage) => (total[key] ?? 0) - (before?.[key] ?? 0);
	const inputTokens = less('input_tokens');
	const outputTokens = less('output_tokens');

	return {
		inputTokens,
		outputTokens,
		totalTokens: inputTokens + outputTokens,
		cachedInputTokens: less('cached_input_tokens'),
		cacheWriteInputTokens: total.cache_write_input_tokens === undefined ? null : less('cache_write_input_tokens'),
		reasoningOutputTokens: less('reasoning_output_tokens')
	};
}

/** True when every count of `total` is at least the one before, so `before` is part of it. */
function continues(total: SessionUsage, before: SessionUsage): boolean {
	return USAGE_KEYS.every((key) => (total[key] ?? 0) >= (before[key] ?? 0));
}

/** How one prompt ended: the answer, the usage, and the error that stopped it, if any. */
export interface CodexOutcome {
	text: string;
	tokens?: TokenUsage;
	error?: LlmError;
}

/**
 * Reads the JSONL of one `codex exec` call. The CLI reports one turn per prompt and only its total usage, so a
 * prompt is one step: `turn.started` starts it and `turn.completed` ends it with the usage. Each finished agent
 * message streams as text and each reasoning summary as reasoning; Recoder's tool calls reach the run over MCP,
 * which reports them. A line that does not parse is an `error` event, never something to act on.
 */
export class CodexReader {
	/** The session the CLI started, which a later prompt resumes and `close` deletes. */
	session: string | undefined;

	private answer = '';
	private usage: TokenUsage | undefined;
	private failure: string | undefined;
	private lastError: string | undefined;

	/**
	 * `sessionTotal` is the session's usage total after the previous prompt, so this prompt's usage is its own; it
	 * holds this prompt's total once the turn completes, for the next prompt's reader.
	 */
	constructor(
		private readonly onEvent: (event: AgentEvent) => void,
		private readonly partPrefix: string,
		public sessionTotal: SessionUsage | null = null
	) {}

	readonly line = (line: string): void => {
		const parsed = eventSchema.safeParse(parseJson(line));

		if (!parsed.success) {
			this.onEvent({ type: 'error', message: `Codex printed a line it should not have: "${quotedLine(line, 120)}"` });

			return;
		}

		this.event(parsed.data);
	};

	/** The prompt's answer, or the error that ended it: the turn's failure, else a non-zero exit, else no answer. */
	finish(exit: CliExit): CodexOutcome {
		const tokens = this.usage;

		if (this.failure !== undefined) return { text: this.answer, tokens, error: codexError(this.failure) };

		if (exit.code !== 0) {
			const message = this.lastError ?? stderrLine(exit.stderr) ?? `Codex exited with code ${exit.code}.`;

			return { text: this.answer, tokens, error: codexError(message) };
		}

		if (!this.answer.trim()) return { text: '', tokens, error: new LlmError(0, 'Codex ended without a reply.') };

		return { text: this.answer, tokens };
	}

	private event(event: CodexEvent): void {
		switch (event.type) {
			case 'thread.started':
				this.session = event.thread_id;
				break;
			case 'turn.started':
				this.onEvent({ type: 'step-start' });
				break;
			case 'turn.completed':
				this.endTurn(event.usage);
				break;
			case 'turn.failed':
				this.failure = event.error.message;
				break;
			case 'item.completed':
				this.item(event.item);
				break;
			case 'error':
				this.lastError = event.message;
				this.onEvent({ type: 'error', message: quotedLine(event.message, QUOTED_CHARS) });
				break;
		}
	}

	private endTurn(total: SessionUsage): void {
		const before = this.sessionTotal && continues(total, this.sessionTotal) ? this.sessionTotal : null;

		this.usage = promptUsage(total, before);
		this.sessionTotal = total;
		this.onEvent({ type: 'usage', usage: this.usage });
	}

	/** A finished item: the agent's message (the last one is the answer), a reasoning summary, or a reported error. */
	private item(item: CodexItem): void {
		const partId = `${this.partPrefix}_${item.id}`;

		if (item.type === 'agent_message' && item.text) {
			this.answer = item.text;
			this.onEvent({ type: 'text', delta: item.text, partId });

			return;
		}

		if (item.type === 'reasoning' && item.text) return this.onEvent({ type: 'reasoning', delta: item.text, partId });

		if (item.type === 'error' && item.message)
			this.onEvent({ type: 'error', message: quotedLine(item.message, QUOTED_CHARS) });
	}
}
