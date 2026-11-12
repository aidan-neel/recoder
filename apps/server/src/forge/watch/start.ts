import type { AutoReviewEvent, Repo, Review } from '@recoder/shared';
import { createReviewSession, startReviewSession, touch } from '../../commands/pipeline';
import { isReviewConfigured } from '../../models/models';
import { recordBrief } from '../../review/chat/chat-replies';
import { supersedeAutomaticReviews } from '../../review/session/supersede';
import { db } from '../../store';
import { requestPullComment } from '../publish/pull-comment';
import type { Trigger, WatchedPull } from './cursor';
import { pullFeed } from './feed';

/** What Recoder has already done on one pull request, for `decidePull`. */
export async function reviewHistory(repoId: string, pull: Pick<WatchedPull, 'number' | 'headSha'>) {
	const reviews = (await db.reviews.list()).filter(
		(review) => review.repoId === repoId && review.prNumber === pull.number && review.status !== 'draft'
	);

	return {
		reviewedBefore: reviews.some((review) => !!review.trigger),
		reviewedHead: !!pull.headSha && reviews.some((review) => review.headSha === pull.headSha)
	};
}

/** React 👀 to the summoning comment. Best effort: a token without write access still gets the review. */
function acknowledge(repo: Repo, prNumber: number, trigger: Trigger): void {
	const feed = pullFeed(repo);

	if (!feed || !trigger.noteId) return;

	feed.react(prNumber, trigger.noteId, trigger.noteStream ?? 'comment').catch((err: unknown) => {
		console.warn(
			`[auto-review] could not react to ${repo.name}#${prNumber}:`,
			err instanceof Error ? err.message : err
		);
	});
}

/**
 * Start the review a trigger asked for, from the watcher or a webhook: cancel
 * the pull request's older automatic review, record the mention's
 * instructions, start, then acknowledge the mention and hand the review to
 * the pull request comment when results are posted. Throws when no reviewer
 * is configured or the review can't start.
 */
export async function startAutoReview(input: {
	repo: Repo;
	pull: Pick<WatchedPull, 'number' | 'headSha'>;
	trigger: Trigger;
	source: NonNullable<Review['trigger']>;
	postResults: boolean;
}): Promise<AutoReviewEvent> {
	const { repo, pull, trigger } = input;

	if (!isReviewConfigured()) throw new Error('Add a reviewer model in Settings so Recoder can review automatically.');
	await supersedeAutomaticReviews(repo.id, pull.number);

	const draft = await createReviewSession(
		{ repoId: repo.id, prNumber: pull.number, ...(pull.headSha ? { headSha: pull.headSha } : {}) },
		input.source
	);

	await touch(draft.id, {
		autoTrigger: {
			reason: trigger.reason,
			...(trigger.by ? { by: trigger.by } : {}),
			...(trigger.noteId ? { noteId: trigger.noteId } : {}),
			...(trigger.discussionId ? { discussionId: trigger.discussionId } : {})
		}
	});

	await recordBrief(draft.id, trigger.instructions);

	const review = await startReviewSession(draft.id);

	if (input.postResults) {
		acknowledge(repo, pull.number, trigger);
		await requestPullComment(review.id);
	}

	return {
		repoId: repo.id,
		prNumber: pull.number,
		reviewId: review.id,
		reason: trigger.reason,
		...(trigger.by ? { by: trigger.by } : {}),
		at: review.startedAt ?? new Date().toISOString()
	};
}
