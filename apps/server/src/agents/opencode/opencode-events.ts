import type { TokenUsage } from '@recoder/shared';
import type { AgentEvent } from '../contract';
import { abortedPromise } from '../../models/llm/openai-compatible';
import { sseData } from '../../models/llm/sse';
import type { OpenCodeServer } from './opencode-server';

/** What a session reports while the model works. A step is one model call; an agent run takes several. */
export interface SessionHandlers {
	onText?: (delta: string, partId: string) => void;
	onReasoning?: (delta: string, partId: string) => void;
	/** `step` is the model message the step produces, when the server names it; it pairs a finish with its start. */
	onStepStart?: (step?: string) => void;
	onStepFinish?: (usage: TokenUsage, step?: string) => void;
	/** A step ended, including when the provider omitted its usage. */
	onStepEnd?: () => void;
	/** The model called a tool; reported by a server version that tells of its tool calls. */
	onToolStart?: (name: string) => void;
	onToolDone?: (call: OwnToolCall) => void;
}

/** A finished tool call, as OpenCode reports it. */
export interface OwnToolCall {
	name: string;
	input: Record<string, unknown>;
	/** The text the model was given back. */
	output: string;
	failed: boolean;
	/** A shell command's exit code; absent for another tool and for a command that never exited. */
	exitCode?: number;
	elapsedMs: number;
}

/** OpenCode's own tool that runs a shell command, whose calls are reported as the commands they ran. */
const SHELL_TOOL = 'shell';

/**
 * The handlers that report the calls of OpenCode's own tools, for a run that works in a checkout. A run on
 * Recoder's tools leaves them out: the MCP host reports those calls itself.
 */
export function ownToolHandlers(onEvent: (event: AgentEvent) => void): SessionHandlers {
	return {
		onToolStart: (name) => onEvent({ type: 'tool-call', name }),
		onToolDone: (call) => {
			const { command } = call.input;

			if (call.name === SHELL_TOOL && typeof command === 'string') {
				onEvent({
					type: 'command',
					command,
					output: call.output,
					exitCode: call.exitCode ?? null,
					elapsedMs: call.elapsedMs
				});
			}

			onEvent({ type: 'tool-result', name: call.name, isError: call.failed });
		}
	};
}

/** The session handlers that report what OpenCode does as the contract's events. */
export function eventHandlers(onEvent: (event: AgentEvent) => void): SessionHandlers {
	return {
		onText: (delta, partId) => onEvent({ type: 'text', delta, partId }),
		onReasoning: (delta, partId) => onEvent({ type: 'reasoning', delta, partId }),
		onStepStart: (step) => onEvent({ type: 'step-start', step }),
		onStepFinish: (usage, step) => onEvent({ type: 'usage', usage, step })
	};
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Follow a session's events until `signal` aborts. Resolves once the stream
 * is connected, so nothing sent after it is missed.
 */
export async function followSession(
	server: OpenCodeServer,
	directory: string,
	sessionId: () => string | null,
	handlers: SessionHandlers,
	signal: AbortSignal
): Promise<void> {
	const { events: api } = await server.api();
	const body = await server.stream(api.path(directory), signal);
	const reader = body.getReader();
	const events = sseData(reader, signal, abortedPromise(signal), () => {});
	const route = api.router(handlers);
	const first = await events.next();

	if (first.done) return;

	void (async () => {
		for await (const data of events) route(safeJson(data), sessionId());
	})()
		.catch(() => {})
		.finally(() => reader.cancel().catch(() => {}));
}
