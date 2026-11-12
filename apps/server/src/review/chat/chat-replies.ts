import { ORCHESTRATOR_ID, type ReviewChatMessage } from '@recoder/shared';
import { emitReviewChatMessage } from '../session/events';
import { currentLease } from '../runtime/ownership';

/** Replies being generated, by review and assignment, so each can be stopped. */
export const pending = new Map<string, AbortController>();

const generations = new Map<string, Promise<void>>();

export function trackChatGeneration(key: string, generation: Promise<void>): void {
	generations.set(key, generation);

	const clear = () => {
		if (generations.get(key) === generation) generations.delete(key);
	};

	if (!currentLease()) void generation.then(clear, clear);
	else void generation.catch(() => undefined);
}

export async function waitReviewChat(reviewId: string, assignmentId: string): Promise<void> {
	const key = keyFor(reviewId, assignmentId);
	const generation = generations.get(key);

	try {
		await generation;
	} finally {
		if (generations.get(key) === generation) generations.delete(key);
	}
}

export const keyFor = (reviewId: string, assignmentId: string) => `${reviewId}:${assignmentId}`;
/** Publish a chat message on the review's event stream; dropped once the review is deleted. */
export function recordChatMessage(reviewId: string, message: ReviewChatMessage): void {
	emitReviewChatMessage(reviewId, message);
}

/**
 * The developer's brief as their message to the orchestrator, recorded before
 * the review starts, so `reviewInstructions` gives it to the review.
 */
export function recordBrief(reviewId: string, text: string | undefined): void {
	const brief = text?.trim();

	if (!brief) return;

	recordChatMessage(reviewId, {
		id: crypto.randomUUID(),
		assignmentId: ORCHESTRATOR_ID,
		from: 'user',
		text: brief,
		at: new Date().toISOString(),
		status: 'done',
		discussion: true
	});
}
export function stopReviewChat(reviewId: string, assignmentId: string): void {
	pending.get(keyFor(reviewId, assignmentId))?.abort();
}
export function cancelReviewChats(reviewId: string, reason?: unknown): void {
	for (const [key, controller] of pending) if (key.startsWith(`${reviewId}:`)) controller.abort(reason);
}
