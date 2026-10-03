import type { ReviewChatMessage } from '@recoder/shared';
import { db } from '../../store';
import { emitReviewEvent } from '../session/events';

/** Replies being generated, by review and assignment, so each can be stopped. */
export const pending = new Map<string, AbortController>();

export const keyFor = (reviewId: string, assignmentId: string) => `${reviewId}:${assignmentId}`;

/** Publish a chat message on the review's event stream; dropped once the review is deleted. */
export function recordChatMessage(reviewId: string, message: ReviewChatMessage): void {
	if (!db.reviews.get(reviewId)) return;
	emitReviewEvent(reviewId, { type: 'message', step: 'chat', message: '', data: { chatMessage: message } });
}

export function stopReviewChat(reviewId: string, assignmentId: string): void {
	pending.get(keyFor(reviewId, assignmentId))?.abort();
}

export function cancelReviewChats(reviewId: string): void {
	for (const [key, controller] of pending) if (key.startsWith(`${reviewId}:`)) controller.abort();
}
