import type { PullRequest, Repo, Review } from '@recoder/shared';

import { readDecisions, type DecisionRecord } from '../review/saved-decisions';
import { SAMPLE_REVIEW } from '../sample/sample-review';
import { queueEntry, sameEntry, type QueueEntry } from './queue';

/** The repository a row belongs to, as `queueEntry` takes it. */
export function entryRepo(entry: QueueEntry): { id: string; name: string } {
	return { id: entry.repoId, name: entry.repo };
}

/** The old list when every entry in the new one is the old one, in order, so nothing downstream recomputes. */
export function sameList(previous: QueueEntry[], next: QueueEntry[]): QueueEntry[] {
	return previous.length === next.length && next.every((entry, index) => entry === previous[index]) ? previous : next;
}

/** The fresh entry, or the old one when it shows exactly the same, so its row skips a render. */
function keep(before: QueueEntry | undefined, next: QueueEntry): QueueEntry {
	return before && sameEntry(before, next) ? before : next;
}

/**
 * A repository's rows. When its pull requests failed to load, its last rows
 * stay, with their reviews brought up to date. A row that shows nothing new
 * keeps its old entry, so it skips a render.
 */
export function rowsOf(
	repo: Repo,
	pulls: PullRequest[] | null,
	latest: Map<string, Review>,
	previous: Map<string, QueueEntry>
): QueueEntry[] {
	const list = pulls ?? [...previous.values()].filter((entry) => entry.repoId === repo.id).map((entry) => entry.pull);

	return list.map((pull) => {
		const review = latest.get(`${repo.id}#${pull.number}`) ?? null;
		const next = queueEntry(repo, pull, review, review ? readDecisions(review.id, review.headSha) : {});

		return keep(previous.get(next.key), next);
	});
}

/**
 * The rows with every review's saved decisions read again, after another tab
 * saved some. In the sample only the sample review keeps its decisions in storage.
 */
export function withSavedDecisions(entries: QueueEntry[], sample: boolean): QueueEntry[] {
	const next = entries.map((entry) => {
		const review = entry.review;

		if (!review || (sample && review.id !== SAMPLE_REVIEW.id)) return entry;

		return keep(entry, queueEntry(entryRepo(entry), entry.pull, review, readDecisions(review.id, review.headSha)));
	});

	return sameList(entries, next);
}

/** The rows with one review's row brought up to date with the copy and decisions the review page holds. */
export function withReview(
	entries: QueueEntry[],
	review: Review,
	records: Record<string, DecisionRecord>
): QueueEntry[] {
	return entries.map((entry) =>
		entry.review?.id === review.id ? queueEntry(entryRepo(entry), entry.pull, review, records) : entry
	);
}
