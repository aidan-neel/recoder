import type { InboxEvent } from '@recoder/shared';
import type { SSEStreamingApi } from 'hono/streaming';
import { EVENT_HEARTBEAT_MS } from '../routes/reviews/event-payload';
import type { MessageStore } from './store';

const POLL_MS = 250;

export async function streamInbox(
	stream: SSEStreamingApi,
	store: MessageStore,
	accountId: string,
	cursor: number | null,
	allowed: () => Promise<boolean>
): Promise<void> {
	let pending = true;
	let wake: (() => void) | undefined;
	let heartbeatAt = Date.now() + EVENT_HEARTBEAT_MS;

	const unsubscribe = store.shared
		? undefined
		: store.subscribe(accountId, () => {
				pending = true;
				wake?.();
			});

	const send = async (event: InboxEvent) => {
		if (stream.aborted) return;

		if (event.type === 'heartbeat') await stream.writeSSE({ data: JSON.stringify(event) });
		else {
			await stream.writeSSE({ id: String(event.cursor), data: JSON.stringify(event) });
			cursor = event.cursor;
		}
	};

	stream.onAbort(() => wake?.());

	try {
		while (!stream.aborted) {
			if (pending || store.shared) {
				pending = false;

				const events = await store.inbox(accountId, cursor);

				if (events.length && !(await allowed())) break;
				for (const event of events) await send(event);
			}

			if (Date.now() >= heartbeatAt) {
				if (!(await allowed())) break;

				await send({ type: 'heartbeat', at: new Date().toISOString() });
				heartbeatAt = Date.now() + EVENT_HEARTBEAT_MS;
			}

			if (pending || stream.aborted) continue;

			await new Promise<void>((resolve) => {
				const untilHeartbeat = Math.max(0, heartbeatAt - Date.now());
				const timer = setTimeout(() => wake?.(), store.shared ? Math.min(POLL_MS, untilHeartbeat) : untilHeartbeat);

				wake = () => {
					clearTimeout(timer);
					wake = undefined;
					resolve();
				};
			});
		}
	} finally {
		unsubscribe?.();
	}
}
