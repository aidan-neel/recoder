import { jest } from 'bun:test';
import { WRITER_HEARTBEAT_MS } from '../../src/repo-chat/chat-record';

/**
 * Replaces `fetch` with a model that streams `chunks`, then hangs until its
 * request is aborted when `hang` is set. It keeps each request's body and
 * abort signal. A hanging model answers one writer heartbeat after it is
 * asked, by the clock: past the pause a reply leaves between saves, so its
 * text is saved as it arrives instead of at the writer's next heartbeat. The
 * caller restores `fetch` and the clock (`jest.useRealTimers()`).
 */
export function streamingModel(
	chunks: string[],
	hang = false
): { bodies: string[]; signals: (AbortSignal | undefined)[] } {
	const bodies: string[] = [];
	const signals: (AbortSignal | undefined)[] = [];

	globalThis.fetch = (async (_url, init) => {
		bodies.push(init?.body as string);
		signals.push(init?.signal ?? undefined);
		if (hang) jest.setSystemTime(Date.now() + WRITER_HEARTBEAT_MS);

		return new Response(
			new ReadableStream({
				start(controller) {
					for (const chunk of chunks)
						controller.enqueue(
							new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`)
						);

					if (!hang) {
						controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
						controller.close();

						return;
					}

					init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
				}
			}),
			{ headers: { 'content-type': 'text/event-stream' } }
		);
	}) as typeof fetch;

	return { bodies, signals };
}
