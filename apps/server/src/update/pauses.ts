import { db } from '../store';
import { continueReviewSession } from '../commands/rerun';
import { getReviewControl } from '../review/session/review-control';
import { emitReviewEvent, flushReviewEvents } from '../review/session/events';
import { holdReviewStarts, releaseReviewStarts } from './hold';
import { UPDATE_RECORD_ID, updateRecords } from './record';

/** Apply states a dead process can leave behind; its boot resumes the recorded reviews and drops the record. */
const INTERRUPTED_STATES = new Set(['checking', 'pausing', 'updating', 'restarting', 'resuming']);

function pauseEvent(paused: boolean) {
	return {
		type: 'step' as const,
		step: 'review',
		message: paused ? 'Review paused for a Recoder update' : 'Review resumed',
		data: { paused }
	};
}

/**
 * Brings every running pipeline to its checkpoint for the update: new reviews
 * are held queued (`holdReviewStarts`), and each running or queued review's
 * control pauses it at its next pause point, exactly as a person's pause
 * does. Returns the recorded ids — the record's write is the caller's, so the
 * ids are durable before the process can exit. Queued persistence is drained
 * before returning, so the checkpoints are on disk.
 */
export async function pauseReviewsForUpdate(): Promise<string[]> {
	holdReviewStarts();

	const paused: string[] = [];

	for (const review of await db.reviews.list()) {
		if (review.status !== 'running' && review.status !== 'queued') continue;

		paused.push(review.id);

		if (getReviewControl(review.id)?.pause()) emitReviewEvent(review.id, pauseEvent(true));

		await flushReviewEvents(review.id);
	}

	return paused;
}

/** The update failed before restarting: let the paused reviews run again and free the start gate. */
export async function resumeHeldReviews(reviewIds: string[]): Promise<void> {
	releaseReviewStarts();

	for (const reviewId of reviewIds) {
		if (getReviewControl(reviewId)?.resume()) emitReviewEvent(reviewId, pauseEvent(false));

		await flushReviewEvents(reviewId);
	}
}

/**
 * The successor's side of the restart, run at boot after `recoverStaleReviews`
 * has closed out what the old process left running: each review the update
 * recorded is continued from its checkpoint, and the record is cleared. A
 * record in a finished state (idle, failed) is left for the UI. Reviews that
 * no longer fit the resume path (deleted, finished, already re-run) are skipped.
 */
export async function resumeAfterUpdate(): Promise<void> {
	releaseReviewStarts();

	const record = await updateRecords.get(UPDATE_RECORD_ID);

	if (!record || !INTERRUPTED_STATES.has(record.state)) return;

	await updateRecords.update(UPDATE_RECORD_ID, (current) => (current ? { ...current, state: 'resuming' } : undefined));

	for (const reviewId of record.pausedReviewIds) {
		const review = await db.reviews.get(reviewId);

		if (review?.status !== 'failed') continue;

		try {
			await continueReviewSession(reviewId);
		} catch (error) {
			console.error('[update] could not resume review', reviewId, error instanceof Error ? error.message : error);
		}
	}

	await updateRecords.delete(UPDATE_RECORD_ID);
}
