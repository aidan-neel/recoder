import { emptyReviewProgress, type Review, type ReviewProgress } from '@recoder/shared';
import { isReviewConfigured } from '../models/models';
import { flushReviewEvents, emitReviewEvent } from '../review/session/events';
import type { ReviewCheckpoint } from '../review/session/review-checkpoint';
import { db, reviewCheckpoints, reviewProgress, reviewReplays } from '../store';
import { runReviewPipeline } from './pipeline';
import { coordinator, storageTransaction } from '../storage/backend';
import { enqueueCommand } from '../review/runtime/inbox';

type Restart = 'continue' | 'rerun' | 'replay';

async function claimRestart(reviewId: string, action: Restart): Promise<Review> {
	if (!(await db.reviews.get(reviewId))) throw new Error('review not found');

	if (!isReviewConfigured()) {
		const phrase =
			action === 'continue'
				? 'continuing the review'
				: action === 'rerun'
					? 'running the review again'
					: 'replaying the review';

		throw new Error(`Add a reviewer model in settings before ${phrase}.`);
	}

	const next = await db.reviews.update(reviewId, (current) => {
		if (!current) throw new Error('review not found');
		if (action === 'continue' && current.status !== 'failed') throw new Error('Only a failed review can be continued.');
		if (action === 'rerun' && current.status !== 'passed' && current.status !== 'failed')
			throw new Error('This review is already running.');
		if (action === 'replay' && current.status !== 'passed') throw new Error('Only a passed review can be replayed.');

		const now = new Date().toISOString();

		return {
			...current,
			status: 'queued',
			updatedAt: now,
			...(action === 'continue' ? {} : { startedAt: now, summary: null, findings: [], unconfirmed: [] })
		};
	});

	if (!next) throw new Error('review not found');

	return next;
}

async function requeue(review: Review, reset: boolean): Promise<Review> {
	const reviewId = review.id;

	emitReviewEvent(reviewId, {
		type: 'step',
		step: 'queued',
		message: '',
		data: reset ? { stage: 'checkout', reset: true } : { stage: 'checkout', outcome: null, failure: null }
	});

	await flushReviewEvents(reviewId);
	if (!coordinator) void runReviewPipeline(reviewId).catch((err) => console.error('[pipeline] failed', err));

	return review;
}

/** A fresh run of a finished review keeps only the conversation, and shows no findings until it finishes. */
async function startOver(review: Review, checkpoint: ReviewCheckpoint | null): Promise<Review> {
	const reviewId = review.id;

	if (checkpoint) await reviewCheckpoints.set(checkpoint);
	else await reviewCheckpoints.delete(reviewId);
	await flushReviewEvents(reviewId);
	await reviewProgress.update(reviewId, (current) => conversationOnly(current ?? emptyReviewProgress(reviewId)));

	return requeue(review, true);
}

/**
 * Continue a failed review where it stopped. Units and finished reviewers
 * are kept from the last checkpoint; without one (or when the PR moved on)
 * the review runs again from the start in the same session.
 */
export async function continueReviewSession(reviewId: string): Promise<Review> {
	return storageTransaction(async (transaction) => {
		if (transaction) await enqueueCommand(transaction, reviewId, { id: crypto.randomUUID(), kind: 'continue' });

		const review = await claimRestart(reviewId, 'continue');

		return requeue(review, false);
	});
}
/**
 * Review a finished session again from the start, in place, because the
 * developer asked for it in the chat. The conversation stays and is the new
 * run's brief. The last run's findings, units and checkpoint are dropped.
 */
export async function rerunReviewSession(reviewId: string): Promise<Review> {
	return storageTransaction(async (transaction) => {
		if (transaction) await enqueueCommand(transaction, reviewId, { id: crypto.randomUUID(), kind: 'rerun' });

		const review = await claimRestart(reviewId, 'rerun');

		return startOver(review, null);
	});
}
/**
 * Replay a passed review from the checkpoint it kept. The reviewers'
 * candidates and verdicts stay, and the detectors, any verification still
 * owed and consolidation run again, so a change to those stages is measured
 * without paying for the reviewers. `reverify` verifies every candidate again,
 * the disproved ones included.
 */
export async function replayReviewSession(reviewId: string, reverify: boolean): Promise<Review> {
	if (!(await db.reviews.get(reviewId))) throw new Error('review not found');

	return storageTransaction(async (transaction) => {
		if (transaction) await enqueueCommand(transaction, reviewId, { id: crypto.randomUUID(), kind: 'replay' });

		const kept = await reviewReplays.get(reviewId);

		if (!kept) throw new Error('This review kept nothing to replay.');

		const review = await claimRestart(reviewId, 'replay');

		return startOver(review, reverify ? withVerdictsCleared(kept) : kept);
	});
}

/** The checkpoint with every verifier's verdict, and what it made publishable, undone, so each candidate is verified again. */
function withVerdictsCleared(checkpoint: ReviewCheckpoint): ReviewCheckpoint {
	const candidates = checkpoint.candidates.map(
		({ verification: _verdict, publishedBy: _reason, refuted, ...candidate }) =>
			refuted ? { ...candidate, valid: true, dropReason: undefined } : candidate
	);

	return { ...checkpoint, candidates };
}

/** The developer's discussion with its replies and their reasoning; everything the last run produced goes. */
function conversationOnly(progress: ReviewProgress): ReviewProgress {
	const messages = (progress.messages ?? []).filter((message) => message.discussion);
	const replies = new Set(messages.map((message) => `reason_${message.id}`));

	return {
		...emptyReviewProgress(progress.id),
		sequence: progress.sequence,
		messages,
		reasoning: (progress.reasoning ?? []).filter((entry) => replies.has(entry.id))
	};
}
