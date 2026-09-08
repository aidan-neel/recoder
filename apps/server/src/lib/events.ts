import { emptyReviewProgress, type ReviewTask } from '@recoder/shared';
import { reviewProgress } from '../store';

/**
 * In-memory per-review event bus backing the SSE endpoint.
 * A short ring buffer is replayed to new subscribers so a late-opening
 * in-progress page (or EventSource reconnect) still sees agent output.
 */

export interface ReviewEvent {
	type: 'step' | 'log' | 'done' | 'error' | 'finding' | 'task';
	/** Machine step name, e.g. `fetch`, `sandbox`, `agent:security`. */
	step?: string;
	message: string;
	/** Structured payload, e.g. `{ agent: 'security', status: 'done', findings: 2 }`. */
	data?: Record<string, unknown>;
	at: string;
	sequence?: number;
}

type Listener = (event: ReviewEvent) => void;

const listeners = new Map<string, Set<Listener>>();
const buffers = new Map<string, ReviewEvent[]>();

const MAX_BUFFER = 400;

export function emitReviewEvent(reviewId: string, event: Omit<ReviewEvent, 'at'>): void {
	const snapshot = reviewProgress.get(reviewId) ?? emptyReviewProgress(reviewId);
	const message: ReviewEvent = { ...event, at: new Date().toISOString(), sequence: snapshot.sequence + 1 };
	snapshot.sequence = message.sequence!;
	snapshot.updatedAt = message.at;
	if (event.type === 'task' && event.data?.task) {
		const task = event.data.task as ReviewTask;
		const previous = snapshot.tasks[task.id];
		const startedAt = previous?.startedAt ?? task.startedAt ??
			(task.status === 'running' ? message.at : undefined);
		snapshot.tasks[task.id] = {
			...previous, ...task, startedAt, updatedAt: message.at,
			elapsedMs: task.elapsedMs ?? (startedAt ? Date.parse(message.at) - Date.parse(startedAt) : previous?.elapsedMs)
		};
		message.data = { ...message.data, task: snapshot.tasks[task.id] };
		// Heartbeats update task timing without flooding the activity history.
		if (previous?.message !== task.message || previous?.status !== task.status) {
			snapshot.activity.push({ sequence: snapshot.sequence, message: task.message, at: message.at, agent: task.agent });
		}
	} else if (event.type !== 'finding') {
		snapshot.activity.push({ sequence: snapshot.sequence, message: message.message, at: message.at, agent: event.data?.agent as string | undefined ?? (event.step?.startsWith('agent:') ? event.step.slice(6) : undefined) });
	}
	snapshot.activity = snapshot.activity.slice(-100);
	reviewProgress.set(snapshot);
	let buf = buffers.get(reviewId);
	if (!buf) {
		buf = [];
		buffers.set(reviewId, buf);
	}
	buf.push(message);
	if (buf.length > MAX_BUFFER) buf.splice(0, buf.length - MAX_BUFFER);
	listeners.get(reviewId)?.forEach((fn) => {
		try {
			fn(message);
		} catch {
			// Listener failures must never break the pipeline.
		}
	});
}

export function subscribeReview(reviewId: string, fn: Listener, replay = true): () => void {
	for (const event of replay ? buffers.get(reviewId) ?? [] : []) {
		try {
			fn(event);
		} catch {
			// Replay failures must never break subscribe.
		}
	}
	let set = listeners.get(reviewId);
	if (!set) {
		set = new Set();
		listeners.set(reviewId, set);
	}
	set.add(fn);
	return () => {
		set.delete(fn);
		if (set.size === 0) listeners.delete(reviewId);
	};
}

export function listenerCount(reviewId: string): number {
	return listeners.get(reviewId)?.size ?? 0;
}

export function reviewEventBuffer(reviewId: string): ReviewEvent[] {
	return buffers.get(reviewId) ?? [];
}

export function clearReviewEvents(reviewId: string): void {
	reviewProgress.delete(reviewId);
	buffers.delete(reviewId);
	listeners.delete(reviewId);
}

export function reportReviewTask(reviewId: string, task: Omit<ReviewTask, 'updatedAt'>): void {
	emitReviewEvent(reviewId, { type: 'task', message: task.message, data: { task } });
}

/** Report liveness during opaque operations without inventing a percentage. */
export async function trackReviewTask<T>(
	reviewId: string,
	id: string,
	label: string,
	work: (detail: (message: string) => void) => Promise<T>
): Promise<T> {
	const started = Date.now();
	let latestMessage = label;
	const update = (status: ReviewTask['status'], message = latestMessage) => reportReviewTask(reviewId, {
		id, label, status, message, startedAt: new Date(started).toISOString(), elapsedMs: Date.now() - started
	});
	update('running');
	const timer = setInterval(() => update('running'), 5000);
	try {
		const result = await work((message) => { latestMessage = message; update('running'); });
		update('done');
		return result;
	} catch (err) {
		update('error', err instanceof Error ? err.message : 'Operation failed');
		throw err;
	} finally {
		clearInterval(timer);
	}
}
