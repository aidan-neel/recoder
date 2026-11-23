import {
	emptyReviewProgress,
	latestReviews,
	reviewListItem,
	type FileDiff,
	type ProgressMessage,
	type PullPage,
	type Review,
	type ReviewListItem,
	type ReviewProgress
} from '@recoder/shared';

import { ApiError } from '../api/http';
import type { StreamHandlers } from '../api/event-stream';
import { SAMPLE_DIFFS, SMALL_DIFF, TOKEN_DIFFS, TOKENS_PULL } from './sample-diff';
import { sampleSeed, type SamplePull, type SampleSeed } from './sample-pulls';
import { SAMPLE_PULL } from './sample-review';
import { finishedPlan } from './sample-run';

/**
 * The sample's memory: its repositories, pull requests, reviews and their
 * live progress, and who follows each review. Built on first use, so loading
 * the module starts nothing.
 */
export function createSampleWorld() {
	let seed: SampleSeed | null = null;
	const progress = new Map<string, ReviewProgress>();
	const followers = new Map<string, Set<StreamHandlers<ProgressMessage>>>();

	/** The seed, built on first use; the reviews running when the sample loads bring their progress. */
	function data(): SampleSeed {
		if (!seed) {
			seed = sampleSeed();

			for (const [id, value] of Object.entries(seed.progress)) progress.set(id, value);
		}

		return seed;
	}

	function findPull(repoId: string, number: number): SamplePull {
		const pull = data().pulls.find((item) => item.repoId === repoId && item.pull.number === number);

		if (!pull) throw new ApiError('pull request not found', 404);

		return pull;
	}

	function findReview(id: string): Review {
		const review = data().reviews.find((item) => item.id === id);

		if (!review) throw new ApiError('review not found', 404);

		return review;
	}

	/** The newest review of a pull request as a list carries it; a real review outranks a newer draft. */
	function newestReview(repoId: string, number: number): ReviewListItem | null {
		const own = data().reviews.filter((review) => review.repoId === repoId && review.prNumber === number);
		const newest = latestReviews(own).values().next().value;

		return newest ? reviewListItem(newest) : null;
	}

	/** A review as the list carries it, with its pull request's state, which a merge or a close changes. */
	function listedReview(review: Review): ReviewListItem {
		return { ...reviewListItem(review), pullState: findPull(review.repoId, review.prNumber).status.state };
	}

	/**
	 * The files of a pull request's diff: the full sample diff for the sample pull request, 300 components for the
	 * tokens one, a short one for the rest.
	 */
	function diffOf(repoId: string, number: number): FileDiff[] {
		if (number === SAMPLE_PULL.number && repoId === 'sample-api') return SAMPLE_DIFFS;
		if (number === TOKENS_PULL && repoId === 'sample-web') return TOKEN_DIFFS;

		return SAMPLE_DIFFS.slice(0, SMALL_DIFF);
	}

	/**
	 * A review's progress. A review that finished before the sample opened never ran here, so it gets the plan a
	 * run would have left: the Changes tab's guide reads it.
	 */
	function progressOf(id: string): ReviewProgress {
		const kept = progress.get(id);

		if (kept) return kept;

		const review = data().reviews.find((item) => item.id === id);
		const paths = review?.status === 'passed' ? diffOf(review.repoId, review.prNumber).map((file) => file.path) : [];

		return { ...emptyReviewProgress(id), ...(paths.length > 0 && { assignments: finishedPlan(paths) }) };
	}

	/** Puts the review in the list in place of its old copy, or adds it. */
	function saveReview(review: Review): void {
		const reviews = [...data().reviews];
		const index = reviews.findIndex((item) => item.id === review.id);

		if (index === -1) reviews.push(review);
		else reviews[index] = review;

		data().reviews = reviews;
	}

	/**
	 * Saves the review and its progress and sends both to everyone following
	 * it. Every publish takes the review's next sequence, whoever sends it, so
	 * the newest snapshot is never taken for a stale one.
	 */
	function publish(review: Review, next: ReviewProgress): void {
		const numbered = { ...next, sequence: progressOf(review.id).sequence + 1 };

		saveReview(review);
		progress.set(review.id, numbered);

		for (const handlers of followers.get(review.id) ?? []) {
			handlers.onMessage({ type: 'snapshot', sequence: numbered.sequence, snapshot: numbered, review });
		}
	}

	/** Removes the review from the sample's memory, with its progress. */
	function deleteReview(id: string): void {
		findReview(id);
		data().reviews = data().reviews.filter((review) => review.id !== id);
		progress.delete(id);
	}

	/** Changes a stored review and sends it on, keeping its progress. */
	function updateReview(id: string, change: (review: Review) => Review): Review {
		const review = change(findReview(id));

		publish(review, progressOf(id));

		return review;
	}

	return {
		data,
		deleteReview,
		findPull,
		findReview,
		listedReview,
		newestReview,
		progressOf,
		publish,
		updateReview,

		/** The pull request leaves the open list, merged. */
		markMerged(repoId: string, number: number): void {
			const merged = findPull(repoId, number);

			data().pulls = data().pulls.map((item) =>
				item === merged ? { ...item, status: { ...item.status, state: 'merged' } } : item
			);
		},

		page(repoId: string, number: number): PullPage {
			const { pull, status } = findPull(repoId, number);

			return {
				provider: 'github',
				repoId,
				pull,
				status,
				capabilities: { comments: true, checks: true, mergeMethods: ['squash', 'merge', 'rebase'] },
				review: newestReview(repoId, number)
			};
		},

		diff(repoId: string, number: number): FileDiff[] {
			findPull(repoId, number);

			return diffOf(repoId, number);
		},

		/** Follows a review: the snapshot comes first, a moment later, as the server sends it. */
		follow(id: string, handlers: StreamHandlers<ProgressMessage>): () => void {
			const set = followers.get(id) ?? new Set();

			set.add(handlers);
			followers.set(id, set);

			void Promise.resolve().then(() => {
				if (!set.has(handlers)) return;

				handlers.onConnection('live');
				handlers.onMessage({ type: 'snapshot', snapshot: progressOf(id), review: findReview(id) });
			});

			return () => set.delete(handlers);
		}
	};
}

export type SampleWorld = ReturnType<typeof createSampleWorld>;
