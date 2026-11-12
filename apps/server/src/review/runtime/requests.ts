import { ORCHESTRATOR_ID, type ReviewChatMessage, type ReviewCodeContext } from '@recoder/shared';
import { db, reviewProgress } from '../../store';
import { coordinator, storageTransaction } from '../../storage/backend';
import { configForAgent } from '../../models/models';
import { ReviewChatError } from '../chat/chat-input';
import { recordChatMessage } from '../chat/chat-replies';
import { flushReviewEvents } from '../session/events';
import { enqueueActor, enqueueCommand } from './inbox';

export async function requestReviewControl(reviewId: string, kind: 'cancel' | 'pause' | 'resume'): Promise<void> {
	if (!coordinator) throw new Error('Shared review coordination is not configured.');

	await storageTransaction(async (transaction) => {
		if (!transaction) throw new Error('Shared review coordination is not configured.');
		await enqueueCommand(transaction, reviewId, { id: crypto.randomUUID(), kind });

		const review = await db.reviews.get(reviewId);

		if (!review) throw new ReviewChatError('review not found', 404);
		if (review.status !== 'running' && review.status !== 'queued')
			throw new ReviewChatError('review is not running', 409);
	});
}

export async function requestChat(
	reviewId: string,
	assignmentId: string,
	text: string,
	codeContext?: ReviewCodeContext
): Promise<ReviewChatMessage> {
	if (!(await db.reviews.get(reviewId))) throw new ReviewChatError('Review not found.', 404);

	const snapshot = await reviewProgress.get(reviewId);
	const assignment = snapshot?.assignments?.find((entry) => entry.id === assignmentId);

	if (assignmentId !== ORCHESTRATOR_ID && !assignment) throw new ReviewChatError('Reviewer not found.', 404);
	configForAgent(assignment?.role);

	return storageTransaction(async (transaction) => {
		if (!transaction) throw new Error('Shared review coordination is not configured.');
		await enqueueActor(transaction, reviewId);
		if (!(await db.reviews.get(reviewId))) throw new ReviewChatError('Review not found.', 404);

		const waiting = await transaction<
			unknown[]
		>`SELECT command_id FROM review_actor_commands WHERE review_id=${reviewId} AND acknowledged_at IS NULL AND command->>'kind'='chat' AND command->>'assignmentId'=${assignmentId} LIMIT 1`;

		if (waiting.length)
			throw new ReviewChatError(
				'This model is still replying. Stop its reply or wait before sending another message.',
				409
			);

		const user: ReviewChatMessage = {
			id: crypto.randomUUID(),
			assignmentId,
			from: 'user',
			text,
			at: new Date().toISOString(),
			status: 'done',
			discussion: true,
			...(codeContext ? { codeContext } : {})
		};

		await enqueueCommand(transaction, reviewId, {
			id: user.id,
			kind: 'chat',
			messageId: user.id,
			assignmentId,
			text,
			at: user.at,
			...(codeContext ? { codeContext } : {})
		});

		recordChatMessage(reviewId, user);
		await flushReviewEvents(reviewId);

		return user;
	});
}
