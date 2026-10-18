import { latestReviews, type PullRequest, type Repo, type Review } from '@recoder/shared';
import { create } from 'zustand';

import { ApiError, failureText, plainly } from '../api/http';
import { reviewsApi, type ProgressSummaries } from '../api/reviews';
import { useReview } from '../review/review-store';
import { DECISIONS_PREFIX, type DecisionRecord } from '../review/saved-decisions';
import { SAMPLE_PROGRESS, sampleQueue } from '../sample/sample-queue';
import { SAMPLE_REVIEW } from '../sample/sample-review';
import { errorToast, undoToast } from '../shell/notify';
import { reviewHref } from '../shell/routes';
import { useShell } from '../shell/shell-store';
import { queueEntry, type QueueEntry } from './queue';
import { entryRepo, rowsOf, sameList, withReview, withSavedDecisions } from './queue-rows';
import { syncTabs } from './queue-tabs';

/**
 * `offline`: the review server did not answer the first load. `empty`: it
 * answered with no tracked repositories.
 */
type QueueStatus = 'loading' | 'ready' | 'offline' | 'empty';

interface QueueStore {
	status: QueueStatus;
	entries: QueueEntry[];
	progress: ProgressSummaries;
	sample: boolean;
	/** True when a refresh failed after a good load; the last list stays on screen. */
	stale: boolean;
	/** Repositories whose pull requests failed to load on the last refresh; their last rows stay on screen. */
	missing: string[];
	/** When the list last loaded, for the note a stale list shows. */
	loadedAt: number | null;
	/** Rows whose start request is in flight, by entry key. */
	starting: Record<string, boolean>;
	/** The row j and k selected; it stays while the person visits a review and comes back. */
	selected: string | null;
	select: (key: string | null) => void;
	/** Loads the queue and keeps it fresh. Returns the cleanup; call it on unmount. */
	load: (sample: boolean) => () => void;
	/**
	 * Keeps the Queue tab's count right on pages without the queue: the live
	 * list loads and refreshes in the background, and the sample's comes from
	 * the sample queue. The shell calls it per scope; returns the cleanup.
	 */
	watch: (sample: boolean) => () => void;
	/** Drops the list, so the next queue page loads it from scratch (after the page failed to render it). */
	reset: () => void;
	/** Reloads repositories, pull requests, reviews and progress. Resolves true when the list loaded. */
	refresh: () => Promise<boolean>;
	/** Reviews the pull request: resumes a failed review, runs a draft, else queues a fresh review of the current head. */
	start: (entry: QueueEntry) => Promise<void>;
	/** Opens a draft session for a pull request with no review, so the person can talk it through before one runs. */
	talk: (entry: QueueEntry) => Promise<void>;
	/** Deletes a review and reloads the list. Rejects with what went wrong, for the dialog to show; callers close its tab. */
	remove: (id: string) => Promise<void>;
}

/** Refresh this often while a row is being reviewed... */
const LIVE_MS = 4000;

/** ...this often otherwise, so new pull requests show up... */
const IDLE_MS = 60_000;

/** ...and this often while the server is down, so the page recovers once it is back. */
const OFFLINE_MS = 15_000;

/** A started sample review finishes one step per tick. */
const SAMPLE_TICK_MS = 900;

/** Steps a started sample review takes. */
const SAMPLE_STEPS = 7;

export const useQueue = create<QueueStore>(() => ({
	status: 'loading',
	entries: [],
	progress: {},
	sample: false,
	stale: false,
	missing: [],
	loadedAt: null,
	starting: {},
	selected: null,
	select: (selected) => set({ selected }),
	load,
	watch,
	reset: () => set({ status: 'loading', entries: [], progress: {}, stale: false, missing: [], loadedAt: null }),
	refresh,
	start,
	talk,
	remove
}));

const get = useQueue.getState;
const set = useQueue.setState;

/** The repositories the last good refresh returned; their pull requests are fetched alongside the next one. */
let repos: Repo[] = [];

let timer: ReturnType<typeof setTimeout> | null = null;

/** True while a queue page is mounted. */
let active = false;

/** True while the shell watches the live queue from a page without it, for the Queue tab's count. */
let watching = false;

/** Bumps on every load and unmount, so a sample run from an earlier visit stops ticking. */
let generation = 0;

/**
 * Bumps when a refresh begins, when the list changes locally and when the
 * store turns to the other queue. A refresh applies only if nothing newer
 * happened while it waited, so a slow answer never undoes a review the person
 * just started, nor lands live rows in the sample.
 */
let seq = 0;

function hasRunning(entries: QueueEntry[]): boolean {
	return entries.some((entry) => entry.state === 'reviewing');
}

/** True while the live list should stay fresh: its queue page shows, or the shell watches it from another page. */
function polling(): boolean {
	return (active || watching) && !get().sample;
}

/** Plans the next refresh: soon while something runs, slowly otherwise. */
function schedule(): void {
	if (timer) clearTimeout(timer);

	timer = null;

	if (!polling()) return;

	const { status, entries } = get();
	const wait = status === 'offline' ? OFFLINE_MS : hasRunning(entries) ? LIVE_MS : IDLE_MS;

	timer = setTimeout(() => void refresh(), wait);
}

function replace(key: string, change: (entry: QueueEntry) => QueueEntry): void {
	set({ entries: get().entries.map((entry) => (entry.key === key ? change(entry) : entry)) });
}

/** One repository's open pull requests, or null when the forge did not answer. */
function pullsOf(repoId: string): Promise<PullRequest[] | null> {
	return reviewsApi.pulls(repoId).catch(() => null);
}

function apply(list: Repo[], pulls: (PullRequest[] | null)[], reviews: Review[], progress: ProgressSummaries): void {
	repos = list;

	if (list.length === 0) {
		set({ status: 'empty', entries: [], stale: false, missing: [], loadedAt: Date.now() });
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
		status: 'ready',
		entries,
		progress: JSON.stringify(progress) === JSON.stringify(get().progress) ? get().progress : progress,
		stale: false,
		missing: list.filter((_, index) => pulls[index] === null).map((repo) => repo.name),
		loadedAt: Date.now()
	});

	syncTabs(reviews, entries);
}

async function refresh(): Promise<boolean> {
	if (!polling()) return false;

	const mine = ++seq;
	const early = new Map(repos.map((repo) => [repo.id, pullsOf(repo.id)]));

	try {
		const [list, reviews, progress] = await Promise.all([
			reviewsApi.repos(),
			reviewsApi.reviews(),
			reviewsApi.progress().catch(() => get().progress)
		]);

		const pulls = await Promise.all(list.map((repo) => early.get(repo.id) ?? pullsOf(repo.id)));

		if (mine !== seq) return false;

		apply(list, pulls, reviews, progress);

		return true;
	} catch {
		if (mine !== seq) return false;

		const { status } = get();

		set(status === 'loading' || status === 'offline' ? { status: 'offline' } : { stale: true });

		return false;
	} finally {
		if (mine === seq) schedule();
	}
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

/** Follows the review open in this tab, so its row (and the Queue badge) keeps up while the person decides. */
function follow(review: Review, records: Record<string, DecisionRecord>): void {
	const { entries } = get();

	if (entries.some((entry) => entry.review?.id === review.id)) set({ entries: withReview(entries, review, records) });
}

/** A sample review that walks through its steps and lands as ready to merge. */
function runSample(entry: QueueEntry): void {
	const id = `sample-${entry.pull.number}`;
	const gen = generation;
	let done = 0;

	const running: Review = {
		...SAMPLE_REVIEW,
		id,
		prNumber: entry.pull.number,
		headSha: entry.pull.headSha,
		status: 'running',
		findings: [],
		questions: undefined
	};

	replace(entry.key, (item) => queueEntry(entryRepo(item), item.pull, running, {}));

	const tick = () => {
		if (generation !== gen) return;

		done += 1;
		set({ progress: { ...get().progress, [id]: { tasksDone: done, tasksTotal: SAMPLE_STEPS, agents: 1 } } });

		if (done < SAMPLE_STEPS) return void setTimeout(tick, SAMPLE_TICK_MS);

		replace(entry.key, (item) => queueEntry(entryRepo(item), item.pull, { ...running, status: 'passed' }, {}));
	};

	setTimeout(tick, SAMPLE_TICK_MS);
}

/** The request that reviews a row: resume a failed review, run a draft session, or queue a fresh review. */
function startRequest(entry: QueueEntry): Promise<Review> {
	if (entry.state === 'failed' && entry.review) return reviewsApi.continue(entry.review.id);
	if (entry.review?.status === 'draft') return reviewsApi.startDraft(entry.review.id);

	return reviewsApi.start(entry.repoId, entry.pull);
}

/** Toasts a failed request with the server's reason and any way out it offered. */
function failed(title: string, error: unknown): void {
	const action = error instanceof ApiError ? error.action : undefined;

	errorToast(title, failureText(error), action);
}

/** Runs a row's request with the row marked as starting, so its button spins until the server answers. */
async function pending(entry: QueueEntry, failure: string, work: () => Promise<void>): Promise<void> {
	set({ starting: { ...get().starting, [entry.key]: true } });

	try {
		await work();
	} catch (error) {
		failed(failure, error);
	} finally {
		const { [entry.key]: _done, ...rest } = get().starting;

		set({ starting: rest });
	}
}

/** Puts a review the server just made on its row, ahead of any refresh already in flight. */
function land(entry: QueueEntry, review: Review): void {
	seq++;
	replace(entry.key, (item) => queueEntry(entryRepo(item), item.pull, review, {}));
}

function startLive(entry: QueueEntry): Promise<void> {
	return pending(entry, 'Couldn’t start the review', async () => {
		land(entry, await startRequest(entry));
		schedule();
	});
}

async function talk(entry: QueueEntry): Promise<void> {
	const current = get().entries.find((item) => item.key === entry.key) ?? entry;

	if (get().sample || get().starting[current.key] || current.review) return;

	await pending(current, 'Couldn’t start the conversation', async () => {
		const review = await reviewsApi.draft(current.repoId, current.pull);

		land(current, review);
		useShell.getState().navigate(reviewHref(review.id));
	});
}

async function remove(id: string): Promise<void> {
	await plainly(() => reviewsApi.remove(id));

	seq++;

	set({
		entries: get().entries.map((entry) =>
			entry.review?.id === id ? queueEntry(entryRepo(entry), entry.pull, null, {}) : entry
		)
	});

	undoToast('Review deleted');
	void refresh();
}

async function start(entry: QueueEntry): Promise<void> {
	const current = get().entries.find((item) => item.key === entry.key) ?? entry;

	if (get().starting[current.key] || current.state === 'reviewing') return;

	if (get().sample) return runSample(current);

	await startLive(current);
}

/** Points the store at one queue, dropping the other queue's list; the sample's list is there at once. */
function point(sample: boolean): void {
	if (get().sample !== sample) {
		seq++;
		set({ entries: [], progress: {}, status: 'loading', loadedAt: null, selected: null });
	}

	set({ sample, stale: false, missing: [], starting: {} });

	if (sample) set({ entries: sampleQueue(), progress: SAMPLE_PROGRESS, status: 'ready' });
}

/** Refreshes at once when no list is loaded yet, else on the timer; the timer stops when nothing should poll. */
function resume(): void {
	if (polling() && get().status === 'loading') void refresh();
	else schedule();
}

function load(sample: boolean): () => void {
	const gen = ++generation;

	active = true;
	point(sample);

	if (!sample) void refresh();

	const onVisible = () => document.visibilityState === 'visible' && void refresh();

	document.addEventListener('visibilitychange', onVisible);

	return () => {
		document.removeEventListener('visibilitychange', onVisible);

		if (generation !== gen) return;

		generation++;
		seq++;
		active = false;

		if (timer) clearTimeout(timer);

		timer = null;

		const { status } = get();

		set({ stale: false, missing: [], ...(status === 'offline' || status === 'empty' ? { status: 'loading' } : {}) });
		resume();
	};
}

function watch(sample: boolean): () => void {
	watching = !sample;

	if (!active) {
		if (get().sample !== sample) point(sample);

		resume();
	}

	return () => {
		watching = false;

		if (!active) schedule();
	};
}

/**
 * The Queue tab's badge: pull requests that need a decision, per queue, so the
 * badge counts the queue its tab leads to. A reload keeps the last count.
 */
useQueue.subscribe((state) => {
	if (state.status === 'loading') return;

	const scope = state.sample ? 'sample' : 'live';
	const waiting = state.status === 'ready' ? state.entries.filter((entry) => entry.state === 'needs-you').length : null;

	if (useShell.getState().waiting[scope] !== waiting) useShell.getState().setWaiting(scope, waiting);
});

useReview.subscribe((state, previous) => {
	if (state.review && (state.records !== previous.records || state.review !== previous.review)) {
		follow(state.review, state.records);
	}
});

if (typeof window !== 'undefined') window.addEventListener('storage', rederive);
