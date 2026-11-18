import { z } from 'zod';
import type { OwnToolCall, SessionHandlers } from '../opencode-events';
import { tokensSchema, usage } from './tokens';

const eventSchema = z.object({
	type: z.string(),
	data: z
		.object({
			sessionID: z.string().optional(),
			assistantMessageID: z.string().optional(),
			ordinal: z.number().optional(),
			delta: z.string().optional(),
			tokens: tokensSchema.optional(),
			id: z.string().optional(),
			name: z.string().optional(),
			input: z.record(z.string(), z.unknown()).optional(),
			content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional(),
			metadata: z.object({ exit: z.number().optional() }).passthrough().optional()
		})
		.passthrough()
});

type EventData = z.infer<typeof eventSchema>['data'];

/** A tool call that has started: its name, and once the model finished writing it, its input and start time. */
interface OpenCall {
	name: string;
	input: Record<string, unknown>;
	startedAt: number;
}

/**
 * Follows the calls of OpenCode's own tools in one session. A call is named when the model starts writing it, gets
 * its input when it is called, and is reported when it succeeds or fails; a call that never ends is dropped.
 */
class ToolCalls {
	private readonly open = new Map<string, OpenCall>();

	constructor(private readonly handlers: SessionHandlers) {}

	/** Takes one `session.tool.*` event; any other event is ignored. */
	route(type: string, data: EventData): void {
		if (!data.id) return;

		if (type === 'session.tool.input.started' && data.name) {
			this.open.set(data.id, { name: data.name, input: {}, startedAt: Date.now() });
		} else if (type === 'session.tool.called') {
			const call = this.open.get(data.id);

			if (!call) return;

			call.input = data.input ?? {};
			call.startedAt = Date.now();
			this.handlers.onToolStart?.(call.name);
		} else if (type === 'session.tool.success' || type === 'session.tool.failed') {
			this.finish(data.id, data, type === 'session.tool.failed');
		}
	}

	private finish(id: string, data: EventData, failed: boolean): void {
		const call = this.open.get(id);

		if (!call) return;

		this.open.delete(id);

		const done: OwnToolCall = {
			name: call.name,
			input: call.input,
			output: (data.content ?? []).map((part) => part.text ?? '').join(''),
			failed,
			elapsedMs: Date.now() - call.startedAt
		};

		if (data.metadata?.exit !== undefined) done.exitCode = data.metadata.exit;

		this.handlers.onToolDone?.(done);
	}
}

/**
 * Routes one session's events to its handlers. A model call can be announced
 * again when the provider is retried, so each step is reported once.
 */
export function sessionRouter(handlers: SessionHandlers): (event: unknown, session: string | null) => void {
	const steps = new Set<string>();
	const tools = new ToolCalls(handlers);

	return (raw, session) => {
		const parsed = eventSchema.safeParse(raw);

		if (!parsed.success || parsed.data.data.sessionID !== session) return;

		const { type, data } = parsed.data;
		const message = data.assistantMessageID ?? '';
		const part = `${message}:${data.ordinal ?? 0}`;

		if (type === 'session.text.delta' && data.delta) handlers.onText?.(data.delta, part);
		else if (type === 'session.reasoning.delta' && data.delta) handlers.onReasoning?.(data.delta, part);
		else if (type.startsWith('session.tool.')) tools.route(type, data);
		else if (type === 'session.step.started' && !steps.has(`start:${message}`)) {
			steps.add(`start:${message}`);
			handlers.onStepStart?.(message || undefined);
		} else if (type === 'session.step.ended' && !steps.has(`end:${message}`)) {
			handlers.onStepEnd?.();

			if (data.tokens) {
				steps.add(`end:${message}`);
				handlers.onStepFinish?.(usage(data.tokens), message || undefined);
			}
		}
	};
}
