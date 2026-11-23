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
 * one with more pages has its next cursor in `nextCursors`, and one whose
 * forge counts its open pull requests has the count in `openCounts`.
 */
export async function listOpenPulls(
	repos: Repo[],
	reviews: ReviewListItem[] | ReadonlyMap<string, ReviewListItem>,
	loadPulls: (repo: Repo) => Promise<OpenPulls>
): Promise<PullList> {
	const reviewOf = newestReviews(reviews);
	const items: PullListItem[] = [];
	const failures: PullList['failures'] = [];
	const nextCursors: PullList['nextCursors'] = {};
	const openCounts: PullList['openCounts'] = {};

	await forEachBounded(repos, REPO_CONCURRENCY, async (repo) => {
		try {
			const { entries, nextCursor, total } = await withPullListDeadline(loadPulls(repo));

			for (const entry of entries) {
				items.push({ repoId: repo.id, ...entry, review: reviewOf(repo.id, entry.pull.number) });
			}

			if (nextCursor !== null) nextCursors[repo.id] = nextCursor;
			if (total !== null) openCounts[repo.id] = total;
		} catch (err) {
			logForgeFailure(`listing pull requests for repo ${repo.id}`, err);
			failures.push({ repoId: repo.id, error: forgeFailureMessage(err) });
		}
	});

	items.sort((a, b) => Date.parse(b.status.updatedAt) - Date.parse(a.status.updatedAt));

	return { items, failures, nextCursors, openCounts, fetchedAt: new Date().toISOString() };
}

/** Uses the stored projection when supplied; otherwise a real review outranks a newer empty draft. */
export function newestReviews(
	reviews: ReviewListItem[] | ReadonlyMap<string, ReviewListItem>
): (repoId: string, n: number) => ReviewListItem | null {
	if (!Array.isArray(reviews)) return (repoId, n) => reviews.get(`${repoId}#${n}`) ?? null;

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

/** Keep one slow repository from blocking the rest of a pull list. Each forge request also has its own timeout. */
export async function withPullListDeadline<T>(promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;

	const deadline = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(
			() => reject(new GhError('unavailable', `The forge took longer than ${REPO_TIMEOUT_MS} ms.`)),
			REPO_TIMEOUT_MS
		);
	});

	try {
		return await Promise.race([promise, deadline]);
	} finally {
		clearTimeout(timer);
	}
}
