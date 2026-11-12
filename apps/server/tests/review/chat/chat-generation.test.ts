import { expect, test } from 'bun:test';
import { keyFor, trackChatGeneration, waitReviewChat } from '../../../src/review/chat/chat-replies';
import { withLease } from '../../../src/review/runtime/ownership';

test('an owned reply failure remains observable even when generation finishes before its actor awaits it', async () => {
	const id = crypto.randomUUID();
	const error = new Error('The reply could not be persisted.');

	withLease({ reviewId: id, ownerId: 'replica', epoch: '1', expiresAt: new Date() }, () => {
		trackChatGeneration(keyFor(id, 'orchestrator'), Promise.reject(error));
	});

	await Promise.resolve();
	await expect(waitReviewChat(id, 'orchestrator')).rejects.toBe(error);
	await waitReviewChat(id, 'orchestrator');
});
