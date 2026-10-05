import { emptyReviewProgress, type Review, type ReviewProgress } from '@recoder/shared';
import { isReviewConfigured } from '../models/models';
import { emitReviewEvent } from '../review/session/events';
import type { ReviewCheckpoint } from '../review/session/review-checkpoint';
import { db, reviewCheckpoints, reviewProgress, reviewReplays } from '../store';
import { runReviewPipeline, touch } from './pipeline';

/** The review if it exists and has a reviewer model to run with; `action` finishes the error message. */
function requireRunnable(reviewId: string, action: string): Review {
	const current = db.reviews.get(reviewId);

	if (!current) throw new Error('review not found');
	if (!isReviewConfigured()) throw new Error(`Add a reviewer model in settings before ${action}.`);

	return current;
}

/** Queues the review again with `patch` applied and runs the pipeline; `reset` clears what the client shows of the last run. */
function requeue(reviewId: string, patch: Partial<Review>, reset: boolean): Review {
	const review = touch(reviewId, { ...patch, status: 'queued' });

	emitReviewEvent(reviewId, {
		type: 'step',
		step: 'queued',
		message: '',
		data: reset ? { stage: 'checkout', reset: true } : { stage: 'checkout', outcome: null, failure: null }
	});

	void runReviewPipeline(reviewId).catch((err) => console.error('[pipeline] failed', err));

	return review;
}

/** A fresh run of a finished review keeps only the conversation, and shows no findings until it finishes. */
function startOver(reviewId: string, checkpoint: ReviewCheckpoint | null): Review {
	if (checkpoint) reviewCheckpoints.set(checkpoint);
	else reviewCheckpoints.delete(reviewId);

	reviewProgress.set(conversationOnly(reviewProgress.get(reviewId) ?? emptyReviewProgress(reviewId)));

	return requeue(reviewId, { startedAt: new Date().toISOString(), summary: null, findings: [], unconfirmed: [] }, true);
}

/**
 * Continue a failed review where it stopped. Units and finished reviewers
 * are kept from the last checkpoint; without one (or when the PR moved on)
 * the review runs again from the start in the same session.
 */
export function continueReviewSession(reviewId: string): Review {
	const current = requireRunnable(reviewId, 'continuing the review');

	if (current.status !== 'failed') throw new Error('Only a failed review can be continued.');

	return requeue(reviewId, {}, false);
}

/**
 * Review a finished session again from the start, in place, because the
 * developer asked for it in the chat. The conversation stays and is the new
 * run's brief. The last run's findings, units and checkpoint are dropped.
 */
export function rerunReviewSession(reviewId: string): Review {
	const current = requireRunnable(reviewId, 'running the review again');

	if (current.status !== 'passed' && current.status !== 'failed') throw new Error('This review is already running.');

	return startOver(reviewId, null);
}

/**
 * Replay a passed review from the checkpoint it kept. The reviewers'
 * candidates and verdicts stay, and the detectors, any verification still
 * owed and consolidation run again, so a change to those stages is measured
 * without paying for the reviewers. `reverify` verifies every candidate again,
 * the disproved ones included.
 */
export function replayReviewSession(reviewId: string, reverify: boolean): Review {
	const current = requireRunnable(reviewId, 'replaying the review');

	if (current.status !== 'passed') throw new Error('Only a passed review can be replayed.');

	const kept = reviewReplays.get(reviewId);

	if (!kept) throw new Error('This review kept nothing to replay.');

	return startOver(reviewId, reverify ? withVerdictsCleared(kept) : kept);
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
