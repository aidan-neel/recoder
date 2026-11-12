import type { Review } from '@recoder/shared';
import { subscribeReview } from '../../review/session/events';
import { db, reviewProgress } from '../../store';
import { GhError } from '../cli';
import { PublishConflictError, reviewForge, type PostedComment, type PullCommentForge } from './forge';
import { savePullComment } from './record';
import { pullCommentMarker, renderPullComment } from './render';
import { postgres } from '../../storage/backend';
import { currentLease } from '../../review/runtime/ownership';
import type { PublicationSession } from '../../storage/postgres-publication';
import { missingComment, publicationLock, publicationOperation, rejectedCreate } from './shared-publication';

/**
 * Recoder's one summary comment on a pull request: posted when someone asks
 * for it (or the review starts), edited in place as the review runs and when
 * it ends, and handed to the next review of the same pull request.
 */

/** The shortest gap between two progress edits of one comment; the final edit never waits. */
const EDIT_INTERVAL_MS = 20_000;

/** A running review's progress edits: the event subscription and the pending throttled edit. */
interface Tracker {
	unsubscribe: () => void;
	timer: ReturnType<typeof setTimeout> | null;
	lastEditAt: number;
	owner: string;
}

const trackers = new Map<string, Tracker>();

/** Each review's writes run one at a time, so an edit never races the create before it. */
const queues = new Map<string, Promise<unknown>>();

/** The body each running review last wrote, so an event that changes nothing visible costs no edit. */
const lastBodies = new Map<string, string>();

function serial<T>(reviewId: string, work: () => Promise<T>): Promise<T> {
	const execute = () => publicationOperation(work);
	const run = (queues.get(reviewId) ?? Promise.resolve()).then(execute, execute);

	const settled = run.then(
		() => undefined,
		() => undefined
	);

	queues.set(reviewId, settled);

	void settled.then(() => {
		if (queues.get(reviewId) === settled) queues.delete(reviewId);
	});

	return run;
}

function inFlight(review: Review): boolean {
	return review.status === 'queued' || review.status === 'running';
}

/** Other reviews of the same pull request, newest first. */
async function siblings(review: Review): Promise<Review[]> {
	return (await db.reviews.list())
		.filter((other) => other.id !== review.id && other.repoId === review.repoId && other.prNumber === review.prNumber)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** A newer review of the same pull request took the comment over; this one must stop writing to it. */
async function handedOn(review: Review): Promise<boolean> {
	return (await siblings(review)).some((other) => other.createdAt > review.createdAt && other.pullComment);
}

/** The comment an earlier review of the same pull request posted, which this one edits instead of posting anew. */
async function inherited(review: Review): Promise<PostedComment | null> {
	const earlier = (await siblings(review)).find((other) => other.pullComment?.id && other.pullComment.url);

	return earlier ? { id: earlier.pullComment!.id!, url: earlier.pullComment!.url! } : null;
}

/**
 * Edit the comment this review knows of (its own or an earlier review's),
 * else the one carrying the marker (after a restart lost the record), else
 * post one. A comment someone deleted is posted again.
 */
async function upsert(
	forge: PullCommentForge,
	review: Review,
	body: string,
	session?: PublicationSession
): Promise<PostedComment> {
	const own = review.pullComment?.id && review.pullComment.url ? review.pullComment : null;
	const known = own ? { id: own.id!, url: own.url! } : await inherited(review);

	if (session) {
		const posted = await session.publish({
			marker: pullCommentMarker(review.prNumber),
			...(known ? { known: { ...known, inline: false } } : {}),
			find: async () => {
				const found = await forge.find(pullCommentMarker(review.prNumber));

				return found ? { ...found, inline: false } : null;
			},
			edit: async (comment) => ({ ...(await forge.edit(comment.id, body)), inline: false }),
			create: async () => ({ ...(await forge.create(body, review.autoTrigger?.discussionId)), inline: false }),
			isMissing: missingComment,
			isRejected: rejectedCreate
		});

		return { id: posted.id, url: posted.url };
	}

	if (known) {
		try {
			return await forge.edit(known.id, body);
		} catch (err) {
			if (!(err instanceof GhError) || err.kind !== 'not-found') throw err;
		}
	}

	const found = await forge.find(pullCommentMarker(review.prNumber));

	if (found) return forge.edit(found.id, body);

	return forge.create(body, review.autoTrigger?.discussionId);
}

function failureText(err: unknown): string {
	return err instanceof Error ? err.message : 'Could not write the pull request comment.';
}

/** Render the review as it stands and write it to the pull request. Throws the forge's error after saving it. */
async function writeLocked(reviewId: string, session?: PublicationSession): Promise<Review> {
	const review = await db.reviews.get(reviewId);

	if (!review) throw new Error('review not found');
	if (await handedOn(review)) return review;

	try {
		const { forge, provider } = await reviewForge(review);
		const running = inFlight(review);

		const body = renderPullComment({
			provider,
			prUrl: review.prUrl,
			prNumber: review.prNumber,
			headSha: review.headSha,
			status: running ? 'running' : review.status === 'passed' ? 'passed' : 'failed',
			summary: running ? null : review.summary,
			findings: review.findings,
			progress: running ? await reviewProgress.get(reviewId) : undefined,
			requestedBy: review.autoTrigger?.by,
			limit: forge.limit
		});

		if (review.pullComment?.id && review.pullComment.state !== 'failed' && lastBodies.get(reviewId) === body)
			return review;

		const posted = await upsert(forge, review, body, session);

		if (running) lastBodies.set(reviewId, body);

		return (
			(await savePullComment(reviewId, { ...posted, state: running ? 'posting' : 'posted', error: undefined })) ??
			review
		);
	} catch (err) {
		await savePullComment(reviewId, { state: 'failed', error: failureText(err) });
		throw err;
	}
}

async function write(reviewId: string): Promise<Review> {
	if (!postgres) return writeLocked(reviewId);

	const review = await db.reviews.get(reviewId);

	if (!review) throw new Error('review not found');

	const { key } = await reviewForge(review);

	return publicationLock(key, (session) => writeLocked(reviewId, session));
}

/** Write in the background; the failure is already saved on the review for the page to show. */
function writeLater(reviewId: string): void {
	void serial(reviewId, () => write(reviewId)).catch((err) =>
		console.warn(`[pull-comment] ${reviewId}: ${failureText(err)}`)
	);
}

/** Queue a progress edit no sooner than `EDIT_INTERVAL_MS` after the last one. */
function scheduleEdit(reviewId: string): void {
	const tracker = trackers.get(reviewId);

	if (!tracker || tracker.timer) return;

	const wait = Math.max(0, tracker.lastEditAt + EDIT_INTERVAL_MS - Date.now());

	tracker.timer = setTimeout(() => {
		tracker.timer = null;
		tracker.lastEditAt = Date.now();
		writeLater(reviewId);
	}, wait);
}

/** Follow a running review's events with throttled edits. */
function track(reviewId: string): void {
	const lease = currentLease();
	const owner = lease ? JSON.stringify([lease.ownerId, lease.epoch]) : '';

	if (trackers.get(reviewId)?.owner === owner) return;
	untrack(reviewId);

	const tracker: Tracker = { unsubscribe: () => undefined, timer: null, lastEditAt: Date.now(), owner };

	trackers.set(reviewId, tracker);
	tracker.unsubscribe = subscribeReview(reviewId, () => scheduleEdit(reviewId), false);
}

function untrack(reviewId: string): void {
	const tracker = trackers.get(reviewId);

	if (!tracker) return;
	if (tracker.timer) clearTimeout(tracker.timer);
	tracker.unsubscribe();
	trackers.delete(reviewId);
	lastBodies.delete(reviewId);
}

export function stopPullCommentTracking(reviewId: string): void {
	untrack(reviewId);
}

/** Mark the review as wanting a comment, and follow it if it is running. */
async function claim(reviewId: string): Promise<Review | undefined> {
	const review = await db.reviews.get(reviewId);

	if (!review) return undefined;
	if (!review.pullComment) await savePullComment(reviewId, { state: 'posting' });
	if (inFlight(review) && (!postgres || currentLease())) track(reviewId);

	return review;
}

/**
 * Comment on the review's pull request and keep that comment current: posted
 * now ("Reviewing…" while it runs), edited as it progresses and when it ends.
 * A draft posts once it starts. For the auto-review watcher; failures are
 * saved on the review rather than thrown.
 */
export async function requestPullComment(reviewId: string): Promise<void> {
	const review = await claim(reviewId);

	if (review && review.status !== 'draft' && !postgres) writeLater(reviewId);
}
/**
 * Write the summary comment now and answer the review with its comment state.
 * Throws the forge's error, or a conflict for a draft or a review a newer one replaced.
 */
export async function publishPullComment(reviewId: string): Promise<Review> {
	const review = await db.reviews.get(reviewId);

	if (review?.status === 'draft')
		throw new PublishConflictError('Start the review before commenting on the pull request.');
	if (review && (await handedOn(review)))
		throw new PublishConflictError('A newer review of this pull request keeps its comment up to date.');
	await claim(reviewId);

	return serial(reviewId, () => write(reviewId));
}
/** The pipeline started a run: a review that asked for a comment posts "Reviewing…" and follows the run. */
export async function trackPullComment(reviewId: string): Promise<void> {
	if (!(await db.reviews.get(reviewId))?.pullComment) return;
	track(reviewId);
	writeLater(reviewId);
}
/** The pipeline's run ended, however it ended: stop following it and write the final comment. */
export async function settlePullComment(reviewId: string): Promise<void> {
	untrack(reviewId);
	if (!(await db.reviews.get(reviewId))?.pullComment) return;

	if (postgres) {
		await serial(reviewId, () => write(reviewId)).catch((error) =>
			console.warn(`[pull-comment] ${reviewId}: ${failureText(error)}`)
		);
	} else writeLater(reviewId);
}
