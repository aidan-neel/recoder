import type { TokenUsage } from '@recoder/shared';
import { abortedPromise } from '../../models/llm/openai-compatible';
import { sseData } from '../../models/llm/sse';
import type { OpenCodeServer } from './opencode-server';

/** What a session reports while the model works. A step is one model call; an agent run takes several. */
export interface SessionHandlers {
	onText?: (delta: string, partId: string) => void;
	onReasoning?: (delta: string, partId: string) => void;
	onStepStart?: () => void;
	onStepFinish?: (usage: TokenUsage) => void;
	/** Any event of this session: proof the run is still moving. */
	onActivity?: () => void;
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
