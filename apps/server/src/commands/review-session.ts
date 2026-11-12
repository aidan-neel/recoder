import { emptyReviewProgress, type CreateReviewInput, type Review } from '@recoder/shared';
import { db, reviewProgress } from '../store';
import { isReviewConfigured } from '../models/models';
import { recordBrief } from '../review/chat/chat-replies';
import { emitReviewEvent, flushReviewEvents } from '../review/session/events';
import { detectProvider } from '../forge/providers';
import { coordinator, storageTransaction } from '../storage/backend';
import { enqueueCommand } from '../review/runtime/inbox';
import { runReviewPipeline } from './pipeline';

export async function touch(reviewId: string, patch: Partial<Review>): Promise<Review> {
	const next = await db.reviews.update(reviewId, (current) => {
		if (!current) throw new Error(`review ${reviewId} not found`);

		return { ...current, ...patch, updatedAt: new Date().toISOString() };
	});

	if (!next) throw new Error(`review ${reviewId} not found`);

	return next;
}
/**
 * Validate + queue a review, kicking the pipeline in the background. A brief
 * in `instructions` is recorded first, so the review runs with it.
 * Throws on bad input.
 * A reviewer model is required — stub reviews that finish in seconds with
 * no real findings are worse than refusing outright.
 */
export async function queueReview(input: CreateReviewInput): Promise<Review> {
	if (!isReviewConfigured()) {
		throw new Error(
			'reviewer not configured: add a reviewer model in settings (or set RECODER_REVIEW_BASE_URL, RECODER_REVIEW_API_KEY and RECODER_REVIEW_MODEL)'
		);
	}

	return storageTransaction(async () => {
		const review = await createReviewSession(input);

		recordBrief(review.id, input.instructions);
		await flushReviewEvents(review.id);

		return startReviewSession(review.id);
	});
}
/** Opening a PR creates durable chat state without running models or the pipeline. */
export async function createReviewSession(input: CreateReviewInput, trigger?: Review['trigger']): Promise<Review> {
	const repo = await db.repos.get(input.repoId);

	if (!repo) throw new Error('repo not found');

	if (!Number.isInteger(input.prNumber) || input.prNumber <= 0) {
		throw new Error('invalid prNumber');
	}

	const now = new Date().toISOString();

	const review: Review = {
		id: crypto.randomUUID(),
		repoId: input.repoId,
		prNumber: input.prNumber,
		headSha: input.headSha ?? 'unknown',
		status: 'draft',
		summary: null,
		findings: [],
		runs: [],
		source: repo.provider ?? detectProvider(repo.url),
		prTitle: input.prTitle ?? null,
		prUrl: null,
		...(trigger ? { trigger } : {}),
		...(input.baselineCache === false ? { baselineCache: false as const } : {}),
		...(input.postComment ? { pullComment: { state: 'posting' as const, updatedAt: now } } : {}),
		createdAt: now,
		updatedAt: now
	};

	await db.reviews.set(review);
	await reviewProgress.set(emptyReviewProgress(review.id));

	return review;
}
/** Claim the draft synchronously so concurrent prompts cannot launch two pipelines. */
export async function startReviewSession(reviewId: string): Promise<Review> {
	if (!(await db.reviews.get(reviewId))) throw new Error('review not found');
	if (!isReviewConfigured()) throw new Error('Add a reviewer model in settings before starting the review.');

	return storageTransaction(async (transaction) => {
		if (transaction) await enqueueCommand(transaction, reviewId, { id: crypto.randomUUID(), kind: 'start' });

		const review = await db.reviews.update(reviewId, (current) => {
			if (!current) throw new Error('review not found');
			if (current.status !== 'draft') throw new Error('This review has already started.');

			return { ...current, status: 'queued', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
		});

		if (!review) throw new Error('review not found');

		emitReviewEvent(reviewId, { type: 'step', step: 'queued', message: '', data: { stage: 'checkout' } });
		await flushReviewEvents(reviewId);
		if (!coordinator) void runReviewPipeline(reviewId).catch((err) => console.error('[pipeline] failed', err));

		return review;
	});
}
