import type { Review } from '@recoder/shared';

import { isRunning } from '../review/review-store';
import { readDecisions } from '../review/saved-decisions';
import { useShell, type TabPatch } from '../shell/shell-store';
import { decisionTally, type QueueEntry } from './queue';

/** A tab's state for one review: a spinner while it runs, else its open decisions and whether any is high. */
function tabState(review: Review): Pick<TabPatch, 'open' | 'high'> {
	if (isRunning(review)) return { open: null, high: false };

	const tally = decisionTally(review, readDecisions(review.id, review.headSha));

	return { open: tally.open, high: tally.tone === 'high' };
}

/**
 * Brings the open tabs up to date with what a queue refresh read, so a review
 * that finishes while the queue shows stops spinning in the bar and shows its
 * count. Only tabs already open change. The pull request's address is kept for
 * the tab menu.
 */
export function syncTabs(reviews: Review[], entries: QueueEntry[]): void {
	const { tabs, patchTabs } = useShell.getState();
	const byId = new Map(reviews.map((review) => [review.id, review]));
	const urls = new Map<string, string>();

	for (const entry of entries) if (entry.review) urls.set(entry.review.id, entry.pull.url);

	patchTabs(
		tabs.flatMap((tab): TabPatch[] => {
			const review = byId.get(tab.id);

			if (!review) return [];

			return [{ id: tab.id, ...tabState(review), url: urls.get(review.id) ?? review.prUrl ?? tab.url ?? null }];
		})
	);
}
