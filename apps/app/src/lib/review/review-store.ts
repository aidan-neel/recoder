import {
	applyProgressMessage,
	emptyReviewProgress,
	type FileDiff,
	type ProgressMessage,
	type PullRequest,
	type Review
} from '@recoder/shared';
import { create } from 'zustand';

import { ApiError, NetworkError } from '../api/http';
import { reviewsApi } from '../api/reviews';
import { SAMPLE_DIFFS } from '../sample/sample-diff';
import { SAMPLE_CHECKS, SAMPLE_PULL, SAMPLE_REVIEW } from '../sample/sample-review';
import { useShell } from '../shell/shell-store';
import { decisionActions, followSavedDecisions, type DecisionActions } from './review-decisions';
import { INITIAL, isRunning, selectionOrder, type ReviewData } from './review-state';
import { ReviewStream } from './review-stream';
import { syncTab } from './review-tab';
import { readDecisions } from './saved-decisions';
import { sameSelection, selectionForItem, type Selection } from './selection';
import { whileVisible } from './while-visible';

export { decisionCounts, isRunning, selectionOrder, surfaceOf } from './review-state';
export { sameSelection, selectionKey, type Selection } from './selection';

interface ReviewActions extends DecisionActions {
	/**
	 * Loads a review and follows it live, opening the item a link named
	 * (`?item=`) once the review has it. Returns the cleanup, which forgets
	 * the review; call it on unmount. `persist: false` keeps decisions in
	 * memory for this load only (the site's demo), never in local storage.
	 */
	load: (id: string, item?: string | null, options?: { persist?: boolean }) => () => void;
	/** Loads the review again after a failed load, keeping the failure on screen until the answer. */
	retry: () => Promise<void>;
	select: (selection: Selection) => void;
	/** Moves through overview, decisions, receipts and files; stops at both ends. */
	step: (by: number) => void;
	setHandoffOpen: (open: boolean) => void;
	setAskOpen: (open: boolean) => void;
	/** Re-reads the review over REST (after an action, or when the stream went quiet). */
	refresh: () => Promise<void>;
}

export type ReviewStore = ReviewData & ReviewActions;

/** While the diff has not been computed yet, ask for it this often. */
const FILES_POLL_MS = 4000;

/** A fresh draft's diff arrives once the server has fetched it, so a draft asks this many times, then stops. */
const DRAFT_FILE_POLLS = 6;

/** While any CI check runs, read them again this often. */
const CHECKS_POLL_MS = 20000;

/** Read the pull request again this often, so commits pushed while the page is open show up. */
const PULL_POLL_MS = 60000;

export const useReview = create<ReviewStore>((set, get) => {
	let stream: ReviewStream | null = null;
	let watchers: (() => void)[] = [];
	let filesTimer: ReturnType<typeof setTimeout> | null = null;
	let filesFlight: { gen: number; again: boolean } | null = null;
	let generation = 0;
	/** False while a load keeps its decisions in memory only. */
	let persist = true;
	let unfollowSaved: (() => void) | null = null;
	const access = { get, set, persists: () => persist };

	/** Drops results that belong to a review the page has since left. */
	function current(id: string, gen: number): boolean {
		return get().id === id && generation === gen;
	}

	/** Takes a newer copy of the review; decisions load once per head commit. */
	function acceptReview(review: Review): void {
		const before = get().review;
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
			loadFiles();
			loadChecks();
		}

		syncTab(get(), !before);
	}

	/** A rerun can drop the selected item; the reading pane then falls back to the overview. */
	function keepSelection(): void {
		const { selection } = get();

		if (!selectionOrder(get()).some((item) => sameSelection(item, selection))) set({ selection: { kind: 'overview' } });
	}

	/**
	 * Selects the item a link named once the review has it. A file can only
	 * match once the diff is in, so the link waits for it until the diff is in
	 * or none is coming (`final`); the person picking something first wins.
	 */
	function openLink(final = get().files.length > 0): void {
		const { link } = get();

		if (!link) return;

		const selection = selectionForItem(link, selectionOrder(get()));

		if (selection) set({ selection, link: null });
		else if (final) set({ link: null });
	}

	/** CI checks for the pull request. A forge that cannot answer counts as no checks, so nothing waits on them. */
	function loadChecks(): void {
		const { id } = get();
		const gen = generation;

		void reviewsApi.checks(id).then(
			({ checks }) => current(id, gen) && set({ checks }),
			() => current(id, gen) && get().checks === null && set({ checks: [] })
		);
	}

	/** True while any CI check has yet to finish. */
	function checksRunning(): boolean {
		return !!get().checks?.some((check) => check.state === 'running' || check.state === 'pending');
	}

	/**
	 * Reads the diff, one request at a time: a call while one is in flight
	 * runs once more after it answers. A running review asks again until the
	 * diff lands; a fresh draft asks a few times while the server fetches it.
	 */
	function loadFiles(polls = 0): void {
		const gen = generation;

		if (filesFlight?.gen === gen) {
			filesFlight.again = true;

			return;
		}

		const flight = { gen, again: false };

		filesFlight = flight;

		if (filesTimer) clearTimeout(filesTimer);

		void readFiles(gen, polls).finally(() => {
			if (filesFlight !== flight) return;

			filesFlight = null;

			if (flight.again) loadFiles();
		});
	}

	async function readFiles(gen: number, polls: number): Promise<void> {
		const { id, sample } = get();

		if (sample || !id) return;

		const files = await reviewsApi.files(id).catch(() => null);

		if (!current(id, gen) || get().status === 'missing') return;

		if (files && files.length > 0) {
			set({ files });
			openLink();
			syncTab(get());

			return;
		}

		const { review } = get();

		if (isRunning(review) || (review?.status === 'draft' && polls < DRAFT_FILE_POLLS)) {
			filesTimer = setTimeout(() => generation === gen && loadFiles(polls + 1), FILES_POLL_MS);
		} else {
			openLink(true);
		}
	}

	/** The pull request by number, open or not; null when the forge cannot say. */
	function readPull(review: Review): Promise<PullRequest | null> {
		return reviewsApi.pull(review.repoId, review.prNumber).catch(() => null);
	}

	/** The pull request's facts and its repository's name, which the header shows together once both answer. */
	async function findPull(review: Review, gen: number): Promise<void> {
		const [pull, repos] = await Promise.all([readPull(review), reviewsApi.repos().catch(() => [])]);

		if (!current(review.id, gen)) return;

		set({ pull, repoName: repos.find((repo) => repo.id === review.repoId)?.name ?? null, pullLoaded: true });
		syncTab(get());
	}

	/** Reads the pull request again, so commits pushed while the page is open raise the outdated notice. */
	async function refreshPull(gen: number): Promise<void> {
		const { review, pull: before } = get();

		if (!review) return;

		const pull = await readPull(review);

		if (pull && current(review.id, gen) && JSON.stringify(pull) !== JSON.stringify(before)) set({ pull });
	}

	function onMessage(message: ProgressMessage): void {
		const { id, progress } = get();

		set({ progress: applyProgressMessage(progress ?? emptyReviewProgress(id), message) });

		if (message.review && message.review.id === id) acceptReview(message.review);

		if (message.type === 'task' && message.data?.task?.id === 'diff' && message.data.task.status === 'done') {
			loadFiles();
		}

		if (message.type === 'heartbeat' && message.status && message.status !== get().review?.status) {
			void get().refresh();
		}
	}

	function loadSample(link: string | null): void {
		set({
			...INITIAL,
			id: 'sample',
			sample: true,
			status: 'ready',
			review: SAMPLE_REVIEW,
			files: SAMPLE_DIFFS,
			pull: SAMPLE_PULL,
			repoName: 'acme/api',
			pullLoaded: true,
			checks: SAMPLE_CHECKS,
			records: persist ? readDecisions(SAMPLE_REVIEW.id, SAMPLE_REVIEW.headSha) : {},
			link
		});

		openLink();
		syncTab(get(), true);
	}

	/** Follows the review while the page is open: the event stream, running CI checks and the pull request's head. */
	function follow(id: string, gen: number): void {
		stream = new ReviewStream(id, {
			onMessage,
			onConnection: (connection) => current(id, gen) && set({ connection }),
			onStale: () => void get().refresh()
		});

		stream.open();

		watchers = [
			whileVisible(CHECKS_POLL_MS, () => checksRunning() && loadChecks()),
			whileVisible(PULL_POLL_MS, () => void refreshPull(gen))
		];
	}

	/** Stops following the review: closes the stream and every poll. */
	function stopFollowing(): void {
		stream?.close();
		stream = null;

		for (const stop of watchers) stop();

		watchers = [];

		if (filesTimer) clearTimeout(filesTimer);

		filesTimer = null;
		filesFlight = null;
	}

	/** The review is gone on the server: stop following it, close its tab and say so. */
	function gone(id: string): void {
		stopFollowing();
		set({ status: 'missing', link: null });
		useShell.getState().closeTabs([id]);
	}

	/**
	 * A load that reached the server and failed: a 404 means the review is
	 * gone, any other answer shows the server's words. Anything else thrown is
	 * the page's own fault, so it is logged and reads as a failed load, never
	 * as a server that is down.
	 */
	function loadFailed(id: string, error: unknown): void {
		if (error instanceof NetworkError) {
			set({ status: 'offline' });
		} else if (error instanceof ApiError) {
			if (error.status === 404) gone(id);
			else set({ status: 'failed', loadError: error.message });
		} else {
			console.error(error);
			set({ status: 'failed', loadError: null });
		}
	}

	async function loadLive(id: string, gen: number): Promise<void> {
		try {
			const [review, files] = await Promise.all([
				reviewsApi.review(id),
				reviewsApi.files(id).catch(() => [] as FileDiff[])
			]);

			if (!current(id, gen)) return;

			set({ files });
			acceptReview(review);

			if (files.length === 0) loadFiles();

			void findPull(review, gen);
			loadChecks();
			follow(id, gen);
		} catch (error) {
			if (current(id, gen)) loadFailed(id, error);
		}
	}

	return {
		...INITIAL,
		...decisionActions(access),

		load(id, item = null, options = {}) {
			const gen = ++generation;

			persist = options.persist ?? true;
			unfollowSaved?.();
			unfollowSaved = followSavedDecisions(access);

			if (id === 'sample') {
				loadSample(item);
			} else {
				set({ ...INITIAL, id, link: item });
				void loadLive(id, gen);
			}

			return () => {
				if (generation !== gen) return;

				generation++;
				stopFollowing();
				unfollowSaved?.();
				unfollowSaved = null;
				set({ ...INITIAL });
			};
		},

		async retry() {
			const { id, status } = get();

			if (id && id !== 'sample' && status !== 'ready' && status !== 'loading') await loadLive(id, generation);
		},

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

		async refresh() {
			const { id, sample } = get();
			const gen = generation;

			if (sample || !id) return;

			try {
				const review = await reviewsApi.review(id);

				if (current(id, gen)) acceptReview(review);
			} catch (error) {
				if (!current(id, gen)) return;

				if (error instanceof ApiError && error.status === 404) gone(id);
				else if (!(error instanceof ApiError || error instanceof NetworkError)) console.error(error);
			}
		}
	};
});
