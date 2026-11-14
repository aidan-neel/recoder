import {
	latestReviews,
	reviewListItem,
	type PullList,
	type PullListItem,
	type Repo,
	type ReviewListItem
} from '@recoder/shared';
import { GhError } from '../cli.js';
import { forgeFailureMessage, logForgeFailure } from './failure.js';
import type { OpenPulls } from './status.js';

/** Repositories whose forge is asked at the same time. */
const REPO_CONCURRENCY = 4;

/** How long one repository's forge may take before it is reported as failed and the rest are answered. */
const REPO_TIMEOUT_MS = 25_000;

/**
 * One page of the open pull requests of `repos`, newest activity first, each
 * joined with its newest review. Repositories load a few at a time; one whose
 * forge fails or is too slow is named in `failures` and the rest still load,
 * and one with more pages has its next cursor in `nextCursors`.
 */
export async function listOpenPulls(
	repos: Repo[],
	reviews: ReviewListItem[],
	loadPulls: (repo: Repo) => Promise<OpenPulls>
): Promise<PullList> {
	const reviewOf = newestReviews(reviews);
	const items: PullListItem[] = [];
	const failures: PullList['failures'] = [];
	const nextCursors: PullList['nextCursors'] = {};

	await forEachBounded(repos, REPO_CONCURRENCY, async (repo) => {
		try {
			const { entries, nextCursor } = await withDeadline(loadPulls(repo), REPO_TIMEOUT_MS);

			for (const entry of entries) {
				items.push({ repoId: repo.id, ...entry, review: reviewOf(repo.id, entry.pull.number) });
			}

			if (nextCursor !== null) nextCursors[repo.id] = nextCursor;
		} catch (err) {
			logForgeFailure(`listing pull requests for repo ${repo.id}`, err);
			failures.push({ repoId: repo.id, error: forgeFailureMessage(err) });
		}
	});

	items.sort((a, b) => Date.parse(b.status.updatedAt) - Date.parse(a.status.updatedAt));

	return { items, failures, nextCursors, fetchedAt: new Date().toISOString() };
}

/** Looks up each pull request's newest review; a real review outranks a newer empty draft. */
export function newestReviews(reviews: ReviewListItem[]): (repoId: string, n: number) => ReviewListItem | null {
	const latest = latestReviews(reviews);

	return (repoId, n) => {
		const review = latest.get(`${repoId}#${n}`);

		return review ? reviewListItem(review) : null;
	};
}

/** Runs `work` on every item with at most `limit` running at once. */
async function forEachBounded<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
	let next = 0;

	const worker = async () => {
		while (next < items.length) await work(items[next++]);
	};

	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** `promise`, or an `unavailable` GhError once `ms` pass first. The slow call itself keeps its own time limit. */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;

	const deadline = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new GhError('unavailable', `The forge took longer than ${ms} ms.`)), ms);
	});

	try {
		return await Promise.race([promise, deadline]);
	} finally {
		clearTimeout(timer);
	}
}
