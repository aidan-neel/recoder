import { z } from 'zod';
import type { TokenUsage } from '@recoder/shared';
import { LlmError } from '../../models/llm/errors';
import type { CliExit } from '../cli-stream';
import type { AgentEvent, AgentReply } from '../contract';
import { quotedLine } from '../quoted-line';
import { ReplyReader, contentBlockDeltaSchema, parseLine, tokenUsage, usageSchema } from './grok-reply';

/**
 * A `stream_event` line: `message_start` opens a model step with its id, `content_block_delta` streams its text
 * and thinking, `message_delta` carries the step's final usage, and `message_stop` ends it. Tool calls and their
 * input arrive as other `content_block_*` events, which this union does not match and the reader ignores — Recoder
 * only needs the model's words and token counts.
 */
const streamEventSchema = z.object({
	type: z.literal('stream_event'),
	event: z.discriminatedUnion('type', [
		contentBlockDeltaSchema,
		z.object({
			type: z.literal('message_start'),
			message: z.object({
				id: z.string(),
				model: z.string().optional(),
				usage: usageSchema.optional()
			})
		}),
		z.object({
			type: z.literal('message_delta'),
			delta: z.object({ stop_reason: z.string().nullable().optional() }).optional(),
			usage: usageSchema.optional()
		}),
		z.object({ type: z.literal('message_stop') })
	])
});

type StreamEvent = z.infer<typeof streamEventSchema>['event'];

/** Longest stretch of an unreadable line quoted in an error event. */
const QUOTED_CHARS = 120;

/** The `system/init` line: proof the session exists, so later prompts resume it instead of creating one. */
const initSchema = z.object({
	type: z.literal('system'),
	subtype: z.literal('init'),
	session_id: z.string()
});

/** A model step in flight: the id its events carry and the usage counters collected so far. */
interface OpenStep {
	id: string;
	usage: z.infer<typeof usageSchema>;
}

/**
 * Turns a Grok run's `streaming-messages-json` lines into the run's events: a `message_start` begins a step (which
 * spends one call of the review's budget), `content_block_delta` streams reasoning and text, `message_stop`
 * reports the step's usage, and the terminal `result` line — read by {@link ReplyReader}, which also owns the
 * answer and every failure mapping — carries the prompt's answer and totals. Lines that are not JSON, `system`
 * lines other than `init`, and `assistant`/`user`/`tool` records are activity at most — the docs warn the stream
 * is not exhaustive, so nothing else fails the run. `sessionStarted` records whether `init` was seen so the next
 * prompt resumes the session.
 */
export class RunReader {
	/** Whether an `init` line proved the session exists and can be resumed. */
	sessionStarted = false;

	private readonly reply = new ReplyReader({});
	private step: OpenStep | null = null;

	constructor(private readonly emit: (event: AgentEvent) => void) {}

	readonly line = (line: string): void => {
		const value = parseLine(line);

		this.reply.line(line);

		if (value === null) {
			this.emit({
				type: 'error',
				message: `Grok Build printed a line that is not JSON: ${quotedLine(line, QUOTED_CHARS)}`
			});

			return;
		}

		const event = streamEventSchema.safeParse(value);

		if (event.success) return this.streamEvent(event.data.event);

		if (initSchema.safeParse(value).success) {
			this.sessionStarted = true;

			return;
		}

		this.emit({ type: 'activity' });
	};

	private streamEvent(event: StreamEvent): void {
		if (event.type === 'message_start') {
			this.step = { id: event.message.id, usage: {} };
			this.emit({ type: 'step-start', step: event.message.id });

			return;
		}

		if (event.type === 'content_block_delta') {
			const { delta, index } = event;
			const partId = `${this.step?.id ?? 'message'}_${index}`;

			if (delta.type === 'thinking_delta' && delta.thinking) {
				this.emit({ type: 'reasoning', delta: delta.thinking, partId });
			} else if (delta.type === 'text_delta' && delta.text) {
				this.emit({ type: 'text', delta: delta.text, partId });
			}

			return;
		}

		if (event.type === 'message_delta') {
			if (this.step && event.usage) this.step.usage = { ...this.step.usage, ...event.usage };

			return;
		}

		this.finishStep();
	}

	private finishStep(): void {
		const step = this.step;

		if (!step) return;

		this.step = null;

		const usage = tokenUsage(step.usage);

		if (usage.inputTokens !== null || usage.outputTokens !== null) {
			this.emit({ type: 'usage', usage, step: step.id });
		}
	}

	/**
	 * The prompt's answer once the process has exited, or the `LlmError` it failed with, both decided by
	 * {@link ReplyReader.finish}: a run without a `result` line failed before it could answer.
	 */
	finish(exit: CliExit): AgentReply {
		this.finishStep();

		let text: string;
		let tokens: TokenUsage | undefined;

		try {
			text = this.reply.finish((usage) => (tokens = usage), exit);
		} catch (error) {
			return {
				text: '',
				error: error instanceof LlmError ? error : new LlmError(0, 'Grok Build run failed.')
			};
		}

		return { text, tokens };
	}
}
