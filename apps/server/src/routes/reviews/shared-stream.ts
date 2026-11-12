import type { SSEStreamingApi } from 'hono/streaming';
import type { Review } from '@recoder/shared';
import type { PostgresEvents } from '../../storage/postgres-events';
import { EVENT_HEARTBEAT_MS, ReviewEventPayloads } from './event-payload';

export async function streamSharedReviewEvents(
	stream: SSEStreamingApi,
	review: Review,
	events: PostgresEvents
): Promise<void> {
	let cursor = 0;
	const payloads = new ReviewEventPayloads(review);
	let lastHeartbeat = Date.now();
	let wake: (() => void) | undefined;

	const send = async (data: unknown) => {
		if (!stream.aborted) await stream.writeSSE({ data: JSON.stringify(data) });
	};

	const snapshot = async () => {
		const payload = await payloads.snapshot();

		cursor = payload.sequence;
		await send(payload);
	};

	stream.onAbort(() => wake?.());

	try {
		await snapshot();

		while (!stream.aborted) {
			const pending = await events.after(review.id, cursor);

			if (pending[0] && pending[0].sequence > cursor + 1) await snapshot();
			else {
				for (const event of pending) {
					await send(await payloads.event(event));
					cursor = event.sequence;
				}
			}

			if (Date.now() - lastHeartbeat >= EVENT_HEARTBEAT_MS) {
				await send(await payloads.heartbeat());
				lastHeartbeat = Date.now();
			}

			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, 250);

				wake = () => {
					clearTimeout(timer);
					resolve();
				};

				if (stream.aborted) wake();
			});
		}
	} finally {
		wake?.();
	}
}
