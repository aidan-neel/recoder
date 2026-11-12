import { z } from 'zod';
import type { TokenUsage } from '@recoder/shared';
import { LlmError } from '../../models/llm/errors';
import type { CliExit } from '../cli-stream';
import type { AgentEvent, AgentReply } from '../contract';
import { ReplyReader, parseLine, tokenUsage, usageSchema } from './claude-code-reply';

type Usage = z.infer<typeof usageSchema>;

/** The SDK stream events `--include-partial-messages` forwards, as far as a run reads them. */
const streamEventSchema = z.object({
	type: z.literal('stream_event'),
	event: z.discriminatedUnion('type', [
		z.object({
			type: z.literal('message_start'),
			message: z.object({ id: z.string(), usage: usageSchema.optional() })
		}),
		z.object({ type: z.literal('message_delta'), usage: usageSchema.optional() }),
		z.object({ type: z.literal('message_stop') }),
		z.object({
			type: z.literal('content_block_delta'),
			index: z.number(),
			delta: z.object({ type: z.string(), text: z.string().optional(), thinking: z.string().optional() })
		})
	])
});

const initSchema = z.object({ type: z.literal('system'), subtype: z.literal('init'), session_id: z.string() });

type StreamEvent = z.infer<typeof streamEventSchema>['event'];

/** Longest stretch of an unreadable line quoted in an error event. */
const QUOTED_CHARS = 120;

/** The model message in progress: its id, and its usage so far. */
interface Step {
	id: string;
	usage: Usage;
}

/**
 * Reads the `stream-json` output of one prompt of an agent run: each model message becomes a step with its own
 * usage, text and thinking deltas stream as events, and the final `result` line (read by {@link ReplyReader}) is
 * the answer. Tool calls are not read here: they reach Recoder over MCP, which reports them.
 */
export class RunReader {
	/** Whether the CLI started its session, so the next prompt can resume it. */
	sessionStarted = false;

	private readonly reply = new ReplyReader({});
	private step: Step | null = null;

	constructor(private readonly onEvent: (event: AgentEvent) => void) {}

	readonly line = (line: string): void => {
		const value = parseLine(line);

		this.reply.line(line);

		if (value === null) {
			this.onEvent({
				type: 'error',
				message: `Claude Code printed a line that is not JSON: "${line.slice(0, QUOTED_CHARS)}"`
			});

			return;
		}

		const streamed = streamEventSchema.safeParse(value);

		if (streamed.success) return this.streamEvent(streamed.data.event);

		if (initSchema.safeParse(value).success) this.sessionStarted = true;

		this.onEvent({ type: 'activity' });
	};

	/** The prompt's answer, or the error that ended it, with what the whole prompt used. */
	finish(exit: CliExit): AgentReply {
		let tokens: TokenUsage | undefined;

		try {
			const text = this.reply.finish((usage) => (tokens = usage), exit);

			return { text, tokens };
		} catch (error) {
			const failure = error instanceof LlmError ? error : new LlmError(0, 'Claude Code run failed.');

			return { text: '', error: failure, tokens };
		}
	}

	private streamEvent(event: StreamEvent): void {
		if (event.type === 'message_start') {
			this.step = { id: event.message.id, usage: event.message.usage ?? {} };
			this.onEvent({ type: 'step-start', step: event.message.id });

			return;
		}

		if (event.type === 'message_delta') return this.addUsage(event.usage);
		if (event.type === 'message_stop') return this.endStep();

		const { delta, index } = event;
		const partId = `${this.step?.id ?? 'message'}_${index}`;

		if (delta.type === 'text_delta' && delta.text) this.onEvent({ type: 'text', delta: delta.text, partId });
		if (delta.type === 'thinking_delta' && delta.thinking)
			this.onEvent({ type: 'reasoning', delta: delta.thinking, partId });
	}

	/** A message's later usage counts replace the ones it started with; the ones it leaves out stay. */
	private addUsage(usage: Usage | undefined): void {
		if (!this.step || !usage) return;

		const started = this.step.usage;

		this.step.usage = {
			input_tokens: usage.input_tokens ?? started.input_tokens,
			output_tokens: usage.output_tokens ?? started.output_tokens,
			cache_creation_input_tokens: usage.cache_creation_input_tokens ?? started.cache_creation_input_tokens,
			cache_read_input_tokens: usage.cache_read_input_tokens ?? started.cache_read_input_tokens,
			output_tokens_details: usage.output_tokens_details ?? started.output_tokens_details
		};
	}

	private endStep(): void {
		if (!this.step) return;

		this.onEvent({ type: 'usage', usage: tokenUsage(this.step.usage), step: this.step.id });
		this.step = null;
	}
}
