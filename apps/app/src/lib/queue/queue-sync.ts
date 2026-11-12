import type { Repo, Review } from '@recoder/shared';

import { useReview } from '../review/review-store';
import { DECISIONS_PREFIX, type DecisionRecord } from '../review/saved-decisions';
import { useShell } from '../shell/shell-store';
import { withReview, withSavedDecisions } from './queue-rows';
import { clearSnapshot, saveSnapshot } from './queue-snapshot';
import type { useQueue } from './queue-store';

interface SyncInput {
	store: typeof useQueue;
	/** The repositories the last load found, saved with the list. */
	repos: () => Repo[];
	/** True while a saved list goes back on screen, so saving does not write the same list straight back. */
	restoring: () => boolean;
}

/**
 * Keeps the queue store in step with the rest of the app: it saves the live
 * list for the next visit, feeds the Queue tab's badge, follows the review
 * open in this tab, and re-reads decisions another tab saved. The store
 * starts it once, as it loads.
 */
export function syncQueue({ store, repos, restoring }: SyncInput): void {
	const get = store.getState;
	const set = store.setState;

	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	/** Saves the live list for the next visit, once per change however many changes land together. */
	function saveSoon(): void {
		if (saveTimer) return;

		saveTimer = setTimeout(() => {
			saveTimer = null;

			const { sample, status, entries, missing, progress, loadedAt } = get();

			if (!sample && status === 'ready') {
				saveSnapshot({ at: loadedAt ?? Date.now(), repos: repos(), entries, missing, progress });
			}
		}, 0);
	}

	/** Follows the review open in this tab, so its row (and the Queue badge) keeps up while the person decides. */
	function follow(review: Review, records: Record<string, DecisionRecord>): void {
		const { entries } = get();

		if (entries.some((entry) => entry.review?.id === review.id)) set({ entries: withReview(entries, review, records) });
	}

	/**
	 * Re-reads saved decisions for every reviewed row when another tab saves
	 * some, so decisions made there move rows at once. Other saves (tabs, notes
	 * being typed) change nothing, and a row whose decisions did not change keeps
	 * its entry. In the sample only the sample review keeps its decisions in storage.
	 */
	function rederive(event: StorageEvent): void {
		const { entries, sample } = get();

		if (entries.length === 0 || (event.key !== null && !event.key.startsWith(DECISIONS_PREFIX))) return;

		set({ entries: withSavedDecisions(entries, sample) });
	}

	store.subscribe((state, previous) => {
		if (restoring() || state.sample) return;

		const changed =
			state.status !== previous.status ||
			state.entries !== previous.entries ||
			state.missing !== previous.missing ||
			state.progress !== previous.progress ||
			state.loadedAt !== previous.loadedAt;

		if (changed && state.status === 'ready') saveSoon();
		if (changed && state.status === 'empty') clearSnapshot();
	});

	/**
	 * The Queue tab's badge: pull requests that need a decision, per queue, so the
	 * badge counts the queue its tab leads to. The saved list keeps it across reloads.
	 */
	store.subscribe((state) => {
		if (state.status === 'loading') return;

		const scope = state.sample ? 'sample' : 'live';

		const waiting =
			state.status === 'ready' ? state.entries.filter((entry) => entry.state === 'needs-you').length : null;

		if (useShell.getState().waiting[scope] !== waiting) useShell.getState().setWaiting(scope, waiting);
	});

	useReview.subscribe((state, previous) => {
		if (state.review && (state.records !== previous.records || state.review !== previous.review)) {
			follow(state.review, state.records);
		}
	});

	if (typeof window !== 'undefined') window.addEventListener('storage', rederive);
}
