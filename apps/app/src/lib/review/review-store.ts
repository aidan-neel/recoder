import type { Review } from '@recoder/shared';
import { create } from 'zustand';

import { cachedReview } from './review-cache';
import { decisionActions, followSavedDecisions, type DecisionActions } from './review-decisions';
import { createFetchers } from './review-fetch';
import { createFollower } from './review-follow';
import { createLoader } from './review-load';
import { quietedActions, type QuietedActions } from './quieted';
import { namedFailure } from './review-read';
import { INITIAL, paneOrder, selectionOrder, type ReviewData } from './review-state';
import { syncTab } from './review-tab';
import { sameData } from './same-data';
import { readDecisions } from './saved-decisions';
import { sameSelection, selectionForItem, type Selection } from './selection';

export { decisionCounts, isRunning, paneOrder, progressStatus, selectionOrder, surfaceOf } from './review-state';
export { sameSelection, selectionKey, type Selection } from './selection';

interface ReviewActions extends DecisionActions, QuietedActions {
	/**
	 * Loads a review and follows it live, opening the item a link named
	 * (`?item=`) once the review has it. A review this tab showed before
	 * paints at once from its last copy and refreshes in place. Returns the
	 * cleanup, which keeps that copy and forgets the review; call it on
	 * unmount. `persist: false` keeps decisions in memory for this load only
	 * (the site's demo), never in local storage, and skips the copies.
	 */
	load: (id: string, item?: string | null, options?: { persist?: boolean }) => () => void;
	/** Loads the review again after a failed load, keeping the failure on screen until the answer. */
	retry: () => Promise<void>;
	/** Reads the diff, the CI checks or the pull request again after a failure; each rejects while it still fails. */
	retryFiles: () => Promise<void>;
	retryChecks: () => Promise<void>;
	retryPull: () => Promise<void>;
	/** Reconnects the live stream now, as the person asked: its first snapshot did not come in time, or it keeps failing. */
	reconnect: () => void;
	select: (selection: Selection) => void;
	/** Moves through overview, decisions, receipts and files; stops at both ends. */
	step: (by: number) => void;
	setHandoffOpen: (open: boolean) => void;
	setAskOpen: (open: boolean) => void;
	/**
	 * Re-reads the review over REST (after an action, or when the stream went
	 * quiet). A read that fails marks the copy on screen stale (`staleSince`).
	 */
	refresh: () => Promise<void>;
}

export type ReviewStore = ReviewData & ReviewActions;

/** True when `review` is an older copy of the review on screen, by the server's clock, which moves on every change. */
function older(review: Review, shown: Review): boolean {
	return review.id === shown.id && Date.parse(review.updatedAt) < Date.parse(shown.updatedAt);
}

/** The fields a forge read's failure lives in, or that its sentence reads. */
const FORGE_FIELDS = ['review', 'repoName', 'pullError', 'checksError', 'checksStale'] as const;

/**
 * `partial` with each rejected token's sentence naming the forge and the
 * repository as the store will hold them once it is written
 * ({@link namedFailure}), so the pull request's and the checks' lines read
 * the same whichever answered first: the failure, the review or the list of
 * names. A write that touches none of them passes as it is.
 */
function withNames(state: ReviewData, partial: Partial<ReviewData>): Partial<ReviewData> {
	if (!FORGE_FIELDS.some((field) => field in partial)) return partial;

	const { review, repoName, pullError, checksError, checksStale } = { ...state, ...partial };
	const named = { ...partial };
	const pull = namedFailure(pullError, review, repoName);
	const checks = namedFailure(checksError, review, repoName);
	const stale = checksStale && namedFailure(checksStale.failure, review, repoName);

	if (pull !== pullError) named.pullError = pull;
	if (checks !== checksError) named.checksError = checks;
	if (checksStale && stale && stale !== checksStale.failure) named.checksStale = { ...checksStale, failure: stale };

	return named;
}

export const useReview = create<ReviewStore>((write, get) => {
	let generation = 0;
	/** False while a load keeps its decisions in memory only. */
	let persist = true;
	let unfollowSaved: (() => void) | null = null;
	/** When the copy on screen was last known to match the server, in ms; 0 when unknown. */
	let confirmedAt = 0;
	/** When the copy the page painted from was kept, in ms; 0 on a first visit. */
	let keptAt = 0;
	const access = { get, set, persists: () => persist };

	/** Writes to the store, with every rejected token's sentence worded from what it then holds ({@link withNames}). */
	function set(partial: Partial<ReviewData>): void {
		write(withNames(get(), partial));
	}

	/** Drops results that belong to a review the page has since left. */
	function current(id: string, gen: number): boolean {
		return get().id === id && generation === gen;
	}

	const fetchers = createFetchers({ get, set, generation: () => generation, current, openLink, keptAt: () => keptAt });

	/**
	 * The server answers again after a refresh could not reach it: clears the
	 * stale mark and reads again the parts that failed meanwhile, so no
	 * failure from the outage stays on the page. A live stream still waiting
	 * out its retry (up to 30s after a long outage) reconnects now.
	 */
	function recovered(): void {
		const { checksError, checksStale, filesError, pullError, connection } = get();

		set({ staleSince: null });

		if (connection === 'reconnecting') follower.reconnect();
		if (checksError || checksStale) void fetchers.loadChecks();
		if (filesError) fetchers.loadFiles();
		if (pullError) fetchers.refreshPull();
	}

	/**
	 * Takes a copy of the review from the server, from a read or the stream,
	 * unless the copy on screen is newer by the server's clock, so an answer
	 * that arrives late never takes the page back, whichever way it came. Any
	 * answer shows the copy on screen is current, so it clears the stale mark.
	 * A copy that says nothing new keeps a shown page as it is, so a refresh
	 * never re-renders it. Decisions load once per head commit.
	 */
	function acceptReview(review: Review): void {
		const before = get().review;

		confirmedAt = Date.now();

		if (get().staleSince !== null) recovered();
		if (before && (older(review, before) || (get().status === 'ready' && sameData(before, review)))) return;

		const headChanged = !before || before.headSha !== review.headSha;

		set({
			review,
			status: 'ready',
			loadError: null,
			...(headChanged ? { records: persist ? readDecisions(review.id, review.headSha) : {}, history: [] } : {})
		});

		keepSelection();
		openLink();

		if (before && before.status !== review.status) {
			fetchers.loadFiles();
			void fetchers.loadChecks();
		}

		syncTab(get(), !before);
	}

	/** A rerun can drop the selected item; the reading pane then falls back to the overview. */
	function keepSelection(): void {
		const { selection } = get();

		if (!paneOrder(get()).some((item) => sameSelection(item, selection))) set({ selection: { kind: 'overview' } });
	}

	/**
	 * Selects the item a link named once the review has it. A file can only
	 * match once the diff is in, so the link waits for it until the diff is in
	 * or none is coming (`final`); the person picking something first wins.
	 */
	function openLink(final = get().files.length > 0): void {
		const { link } = get();

		if (!link) return;

		const selection = selectionForItem(link, paneOrder(get()));

		if (selection) set({ selection, link: null });
		else if (final) set({ link: null });
	}

	const follower = createFollower({
		get,
		set,
		current,
		fetchers,
		accept: acceptReview,
		heard: () => (confirmedAt = Date.now()),
		refresh: () => get().refresh()
	});

	const loader = createLoader({
		get,
		set,
		generation: () => generation,
		current,
		openLink,
		fetchers,
		follower,
		accept: acceptReview,
		keepSelection,
		persists: () => persist,
		confirmed: (at) => {
			confirmedAt = at;
			keptAt = at;
		},
		stale: () => get().status === 'ready' && get().staleSince === null && set({ staleSince: confirmedAt })
	});

	return {
		...INITIAL,
		...decisionActions(access),
		...quietedActions(access),

		load(id, item = null, options = {}) {
			const gen = ++generation;

			persist = options.persist ?? true;
			confirmedAt = 0;
			keptAt = 0;
			unfollowSaved?.();
			unfollowSaved = followSavedDecisions(access);

			const cached = persist && id !== 'sample' ? cachedReview(id) : null;

			if (id === 'sample') loader.loadSample(item);
			else if (cached) loader.restore(id, item, cached, gen);
			else {
				set({ ...INITIAL, id, link: item });
				void loader.loadLive(id, gen);
			}

			const keep = () => current(id, gen) && loader.remember();
			const page = typeof window === 'undefined' ? null : window;

			page?.addEventListener('pagehide', keep);

			return () => {
				if (generation !== gen) return;

				loader.remember('idle');
				page?.removeEventListener('pagehide', keep);
				generation++;
				follower.stop();
				unfollowSaved?.();
				unfollowSaved = null;
				set({ ...INITIAL });
			};
		},

		async retry() {
			const { id, status } = get();

			if (id && id !== 'sample' && status !== 'ready' && status !== 'loading') await loader.loadLive(id, generation);
		},

		retryFiles: () => fetchers.retryFiles(),

		retryChecks: () => fetchers.retryChecks(),

		retryPull: () => fetchers.retryPull(),

		reconnect: () => follower.reconnect(),

		select(selection) {
			set({ selection, link: null });
		},

		step(by) {
			const order = selectionOrder(get());
			const at = order.findIndex((item) => sameSelection(item, get().selection));
			const next = order[Math.min(Math.max(at + by, 0), order.length - 1)];

			if (next) get().select(next);
		},

		setHandoffOpen: (handoffOpen) => set({ handoffOpen }),

		setAskOpen: (askOpen) => set({ askOpen }),

		refresh: () => loader.refresh()
	};
});
