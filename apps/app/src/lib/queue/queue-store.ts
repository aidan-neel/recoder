import { latestReviews } from '@recoder/shared';
import { whenIdle } from '@recoder/ui';
import { useLayoutEffect } from 'react';
import { create } from 'zustand';

import { failureKind, failureText, NetworkError } from '../api/http';
import type { ProgressSummaries } from '../api/reviews';
import { SAMPLE_PROGRESS, sampleQueue } from '../sample/sample-queue';
import { useShell, type QueueScope } from '../shell/shell-store';
import type { QueueEntry } from './queue';
import { queueActions } from './queue-actions';
import { fetchQueue, forgetPulls, retryDelay, type MissingRepo, type QueueData } from './queue-fetch';
import { rowsOf, sameList, withSavedDecisions } from './queue-rows';
import { clearSnapshot, readSnapshot, savedRepos } from './queue-snapshot';
import { syncQueue } from './queue-sync';
import { syncTabs } from './queue-tabs';

/**
 * `offline`: the first load never reached the review server. `failed`: the
 * server answered it with an error, or did not answer in time. `empty`: it
 * answered with no tracked repositories.
 */
type QueueStatus = 'loading' | 'ready' | 'offline' | 'failed' | 'empty';

interface QueueStore {
	status: QueueStatus;
	entries: QueueEntry[];
	progress: ProgressSummaries;
	sample: boolean;
	/**
	 * What the last refresh's failure says, in plain words; null once one
	 * succeeds. With a list on screen, that list stays, from `loadedAt`.
	 */
	error: string | null;
	/** Repositories whose pull requests failed to load on the last refresh, and why; their last rows stay on screen. */
	missing: MissingRepo[];
	/** How many repositories the list on screen covers, so a page with no rows can tell whether every list failed. */
	tracked: number;
	/** When the list on screen loaded. */
	loadedAt: number | null;
	/** True when the list on screen has missed a few refreshes in a row, though none failed outright, so it never passes for live. */
	stale: boolean;
	/** True while the list on screen is the one an earlier visit saved and no refresh has answered yet. */
	restored: boolean;
	/** Rows whose start request is in flight, by entry key. */
	starting: Record<string, boolean>;
	/** The row j and k selected; it stays while the person visits a review and comes back. */
	selected: string | null;
	select: (key: string | null) => void;
	/** Loads the queue and keeps it fresh while the page shows. Returns the cleanup; call it on unmount. */
	load: (sample: boolean) => () => void;
	/** Drops the list, saved copy included, so the next queue page loads it from scratch (after the page failed to render it). */
	reset: () => void;
	/** Reloads repositories, reviews and progress, and asks every forge again. Resolves true when the list loaded. */
	refresh: () => Promise<boolean>;
	/** Reviews the pull request: resumes a failed review, runs a draft, else queues a fresh review of the current head. */
	start: (entry: QueueEntry) => Promise<void>;
	/** Opens a draft session for a pull request with no review, so the person can talk it through before one runs. */
	talk: (entry: QueueEntry) => Promise<void>;
	/** Deletes a review and reloads the list. Rejects with what went wrong, for the dialog to show; callers close its tab. */
	remove: (id: string) => Promise<void>;
}

/** Refresh the review list and progress this often while a row is being reviewed... */
const LIVE_MS = 4000;

/**
 * ...and everything this often otherwise, so new pull requests show up and a
 * server that stopped shows within seconds. The forge is still asked at most
 * once a minute (see `PULLS_MS`). A failed load retries sooner (see `retryDelay`).
 */
const IDLE_MS = 15_000;

/** A list older than this has missed a few planned refreshes... */
const STALE_MS = 3 * IDLE_MS;

/**
 * ...and says how old it is once a refresh has run this long without an
 * answer. A refresh that lands sooner, say right after the computer wakes,
 * shows no note at all instead of one that folds open and shut.
 */
const STALE_GRACE_MS = 2000;

/** The longest a list the last visit saved waits for its first refresh while the page draws it. */
const FIRST_REFRESH_WAIT_MS = 1000;

const EMPTY: Pick<
	QueueStore,
	'entries' | 'progress' | 'error' | 'missing' | 'tracked' | 'loadedAt' | 'stale' | 'restored'
> = {
	entries: [],
	progress: {},
	error: null,
	missing: [],
	tracked: 0,
	loadedAt: null,
	stale: false,
	restored: false
};

export const useQueue = create<QueueStore>(() => ({
	...EMPTY,
	status: 'loading',
	sample: false,
	starting: {},
	selected: null,
	select: (selected) => set({ selected }),
	load,
	reset,
	refresh: () => refreshWith(true),
	start: (entry) => actions.start(entry),
	talk: (entry) => actions.talk(entry),
	remove: (id) => actions.remove(id)
}));

const get = useQueue.getState;
const set = useQueue.setState;

/** The repositories the last load found; their pull requests are asked for alongside the next one's list. */
let repos: QueueData['repos'] = [];

let timer: ReturnType<typeof setTimeout> | null = null;

/** True while a queue page is mounted: only then does the list refresh. */
let active = false;

/** Bumps on every load and unmount, so a sample run from an earlier visit stops ticking. */
let generation = 0;

/**
 * Bumps when a refresh begins, when the list changes locally and when the
 * store turns to the other queue. A refresh applies only if nothing newer
 * happened while it waited, so a slow answer never undoes a review the person
 * just started, nor lands live rows in the sample.
 */
let seq = 0;

/** The refresh in flight; another asked for before anything newer happened joins it instead of asking again. */
let inflight: { seq: number; done: Promise<boolean> } | null = null;

/** Failed loads in a row, for the retry's backoff. */
let failures = 0;

/** True while a saved list goes back on screen, so saving does not write the same list straight back. */
let restoring = false;

function hasRunning(entries: QueueEntry[]): boolean {
	return entries.some((entry) => entry.state === 'reviewing');
}

/** True while the live list should stay fresh: its queue page shows. */
function polling(): boolean {
	return active && !get().sample;
}

/** True while the browser tab is in the background, where nothing reads the list. */
function hidden(): boolean {
	return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Marks the list on screen as old when it has missed a few planned refreshes,
 * so a silent failure cannot pass for live. A list the last visit saved is
 * left alone while its first refresh runs: it paints as part of the page, and
 * a note folding in over it at boot would shift the page for no failure.
 */
function markStale(): void {
	const { loadedAt, stale, restored } = get();

	if (!stale && !restored && loadedAt !== null && Date.now() - loadedAt > STALE_MS) set({ stale: true });
}

/**
 * Plans the next refresh: soon after a failure (1, 2, 4, 8, then every 15
 * seconds), every few seconds while something runs, every 15 seconds
 * otherwise. A tab in the background plans none; it refreshes when it shows.
 */
function schedule(): void {
	if (timer) clearTimeout(timer);

	timer = null;

	if (!polling() || hidden()) return;

	const { error, entries } = get();
	const wait = error !== null ? retryDelay(failures) : hasRunning(entries) ? LIVE_MS : IDLE_MS;

	timer = setTimeout(() => void refreshWith(false), wait);
}

/** The new value, or the old one when it holds the same, so nothing that reads it renders again. */
function same<T>(before: T, next: T): T {
	return JSON.stringify(before) === JSON.stringify(next) ? before : next;
}

/** Puts a whole refresh on screen at once: every row, the progress and what failed. */
function apply({ repos: list, pulls, missing, reviews, progress }: QueueData): void {
	repos = list;

	const settled = { error: null, tracked: list.length, loadedAt: Date.now(), stale: false, restored: false };

	if (list.length === 0) {
		set({ ...settled, status: 'empty', entries: [], missing: [] });
		syncTabs(reviews, []);

		return;
	}

	const latest = latestReviews(reviews);
	const previous = get().entries;
	const before = new Map(previous.map((entry) => [entry.key, entry]));

	const entries = sameList(
		previous,
		list.flatMap((repo, index) => rowsOf(repo, pulls[index], latest, before))
	);

	set({
		...settled,
		status: 'ready',
		entries,
		progress: same(get().progress, progress ?? get().progress),
		missing: same(get().missing, missing)
	});

	syncTabs(reviews, entries);
}

/**
 * A refresh that failed. A list on screen stays, marked with what went
 * wrong; without one the page says it. Only a server that never answered
 * reads as offline: an error it sent, or a slow answer, reads as failed.
 */
function fail(error: unknown): void {
	const text = failureText(error);
	const { status } = get();

	if (status === 'ready' || status === 'empty') return set({ error: text });

	set({ status: failureKind(error) === 'offline' ? 'offline' : 'failed', error: text });
}

/** Loads the queue for refresh `mine`; an old list says how old it is if the answer is slow (see {@link STALE_GRACE_MS}). */
async function run(mine: number, force: boolean): Promise<boolean> {
	const slow = setTimeout(markStale, STALE_GRACE_MS);

	try {
		const data = await fetchQueue(repos, force);

		if (mine !== seq) return false;

		failures = 0;
		apply(data);

		return true;
	} catch (error) {
		if (mine !== seq) return false;

		failures += 1;
		fail(error);

		return false;
	} finally {
		clearTimeout(slow);

		if (mine === seq) schedule();
	}
}

/**
 * Reloads the queue. One already in flight is joined unless something newer
 * happened since it began, so a page mounted twice (StrictMode) asks once.
 * `force` asks every forge for its pull requests again and never joins.
 */
function refreshWith(force: boolean): Promise<boolean> {
	if (!polling()) return Promise.resolve(false);
	if (!force && inflight?.seq === seq) return inflight.done;

	const mine = ++seq;

	const done = run(mine, force).finally(() => {
		if (inflight?.seq === mine) inflight = null;
	});

	inflight = { seq: mine, done };

	return done;
}

/** True while a refresh of the list is in flight. */
export function queueRefreshing(): boolean {
	return inflight !== null;
}

/** Marks a change made here, so a refresh already in flight does not undo it. */
function touch(): void {
	seq++;
}

const actions = queueActions({
	get,
	set,
	touch,
	schedule,
	refresh: () => refreshWith(false),
	generation: () => generation
});

/** Puts the list the last visit saved back on screen, not yet confirmed; one too old to paint still lends its repositories. */
function restore(): void {
	const snapshot = readSnapshot();

	repos = snapshot?.repos ?? savedRepos();

	if (!snapshot) return;

	restoring = true;

	set({
		status: 'ready',
		entries: withSavedDecisions(snapshot.entries, false),
		progress: snapshot.progress,
		missing: snapshot.missing,
		tracked: snapshot.repos.length,
		loadedAt: snapshot.at,
		stale: false,
		restored: true,
		error: null
	});

	restoring = false;
}

/**
 * Points the store at one queue, dropping the other queue's list. The
 * sample's list is there at once; the live one comes back from the last
 * visit's saved copy while it loads.
 */
function point(sample: boolean): void {
	if (get().sample !== sample) {
		seq++;
		failures = 0;
		set({ ...EMPTY, status: 'loading', selected: null });
	}

	set({ sample, starting: {} });

	if (sample) set({ entries: sampleQueue(), progress: SAMPLE_PROGRESS, status: 'ready' });
	else if (get().status === 'loading') restore();
}

function reset(): void {
	seq++;
	failures = 0;
	repos = [];
	clearSnapshot();
	forgetPulls();
	set({ ...EMPTY, status: 'loading' });
}

/** The network dropped: the list says so at once instead of at its next refresh, and retries on the failure's backoff. */
function wentOffline(): void {
	if (!polling()) return;

	failures += 1;
	fail(new NetworkError('The browser went offline.'));
	schedule();
}

/**
 * Shows the queue and keeps it fresh while the page is mounted: it refreshes
 * on the timer, when the tab shows again, and at once when the network or the
 * window comes back after a failed load. The network dropping shows at once.
 * A list the last visit saved is already on screen, so its first refresh
 * waits until the page is idle: the page draws the rows below the first
 * screen in batches after it paints, and an answer that changes the list
 * meanwhile would make it draw them again.
 */
function load(sample: boolean): () => void {
	const gen = ++generation;

	active = true;
	point(sample);

	const cancelFirst = !sample && get().restored ? whenIdle(() => void refreshWith(false), FIRST_REFRESH_WAIT_MS) : null;

	if (!sample && !cancelFirst) void refreshWith(false);

	const onVisible = () => (hidden() ? schedule() : void refreshWith(false));
	const onBack = () => get().error !== null && void refreshWith(false);

	document.addEventListener('visibilitychange', onVisible);
	window.addEventListener('online', onBack);
	window.addEventListener('offline', wentOffline);
	window.addEventListener('focus', onBack);

	return () => {
		cancelFirst?.();

		document.removeEventListener('visibilitychange', onVisible);
		window.removeEventListener('online', onBack);
		window.removeEventListener('offline', wentOffline);
		window.removeEventListener('focus', onBack);

		if (generation !== gen) return;

		generation++;
		active = false;

		if (timer) clearTimeout(timer);

		timer = null;

		const { status } = get();

		if (status === 'offline' || status === 'failed' || status === 'empty') set({ status: 'loading', error: null });
	};
}

/**
 * The Queue tab's badge for one queue: the pull requests that need a
 * decision, or null before that queue has loaded. Off the queue page it
 * points the store at that queue without asking the server: the live queue
 * comes back from the last visit's saved copy, the sample from its fixed
 * rows. Decisions on the review page then keep the count right (`follow`).
 */
export function useQueueWaiting(scope: QueueScope): number | null {
	useLayoutEffect(() => {
		if (!active) point(scope === 'sample');
	}, [scope]);

	return useShell((state) => state.waiting[scope]);
}

syncQueue({ store: useQueue, repos: () => repos, restoring: () => restoring });
