import type { AutoReviewSettings, AutoReviewStatus, Repo } from '@recoder/shared';
import { db } from '../../store';
import {
	CLOCK_SKEW_MS,
	decidePull,
	readWatchState,
	writeWatchState,
	type WatchedNote,
	type WatchedPull
} from './cursor';
import { pullFeed, watchable, type PullFeed } from './feed';
import { readAutoReviewSettings } from './settings';
import { reviewHistory, startAutoReview } from './start';

/** The first round waits a little after boot or a settings change, so a burst of saves runs one round. */
const FIRST_ROUND_MS = 3_000;

/** One updated pull request and its comments, fetched before any decision is made. */
interface PullActivity {
	pull: WatchedPull;
	notes: WatchedNote[];
}

const runtime: {
	timer: ReturnType<typeof setTimeout> | null;
	round: Promise<void> | null;
	lastCheckAt: string | null;
	nextCheckAt: string | null;
	errors: AutoReviewStatus['errors'];
} = { timer: null, round: null, lastCheckAt: null, nextCheckAt: null, errors: [] };

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Tracked GitHub and GitLab repositories the settings don't exclude. */
function watchedRepos(settings: AutoReviewSettings): Repo[] {
	return db.repos.list().filter((repo) => watchable(repo) && !settings.excludedRepoIds.includes(repo.id));
}

/** Pull requests updated since a little before the last check, each with its comments. */
async function fetchActivity(feed: PullFeed, checkedAt: string): Promise<PullActivity[]> {
	const since = new Date(Date.parse(checkedAt) - CLOCK_SKEW_MS).toISOString();
	const activity: PullActivity[] = [];

	for (const pull of await feed.updatedPulls(since))
		activity.push({ pull, notes: await feed.notes(pull.number, since) });

	return activity;
}

/**
 * Decide, start and persist in one synchronous step, re-reading the state
 * first, so a webhook handled while the forge was being read is never
 * overwritten or handled twice. Returns why any review failed to start.
 */
function applyActivity(
	repo: Repo,
	settings: AutoReviewSettings,
	round: { checkedAt: string | null; startedAt: string },
	activity: PullActivity[]
): string[] {
	const state = readWatchState();
	const cursor = (state.repos[repo.id] ??= { checkedAt: round.startedAt, pulls: {} });
	const failures: string[] = [];

	for (const { pull, notes } of round.checkedAt ? activity : []) {
		const decision = decidePull({
			settings,
			checkedAt: round.checkedAt,
			cursor: cursor.pulls[pull.number],
			pull,
			notes,
			...reviewHistory(repo.id, pull),
			now: round.startedAt
		});

		cursor.pulls[pull.number] = decision.cursor;

		if (!decision.trigger) continue;

		try {
			state.recent.unshift(
				startAutoReview({ repo, pull, trigger: decision.trigger, source: 'auto', postResults: settings.postResults })
			);
		} catch (err) {
			failures.push(`#${pull.number}: ${message(err)}`);
		}
	}

	cursor.checkedAt = round.startedAt;
	writeWatchState(state);

	return failures;
}

/** One repository's round. The first ever check only records the time: what is already there is history. */
async function checkRepo(repo: Repo, settings: AutoReviewSettings): Promise<void> {
	const feed = pullFeed(repo);

	if (!feed) return;

	const startedAt = new Date().toISOString();
	const checkedAt = readWatchState().repos[repo.id]?.checkedAt ?? null;
	const activity = checkedAt ? await fetchActivity(feed, checkedAt) : [];
	const failures = applyActivity(repo, settings, { checkedAt, startedAt }, activity);

	if (failures.length) throw new Error(`Couldn't start a review for ${failures.join('; ')}`);
}

/** Check every watched repository in turn. A failing one is recorded and the rest still run. */
async function checkAll(): Promise<void> {
	const settings = readAutoReviewSettings();
	const errors: AutoReviewStatus['errors'] = [];

	for (const repo of watchedRepos(settings)) {
		try {
			await checkRepo(repo, settings);
		} catch (err) {
			errors.push({ repoId: repo.id, message: message(err) });
		}
	}

	runtime.errors = errors;
	runtime.lastCheckAt = new Date().toISOString();
}

/** One round at a time: a round asked for while one runs waits for that one. */
function runRound(): Promise<void> {
	runtime.round ??= checkAll().finally(() => {
		runtime.round = null;
	});

	return runtime.round;
}

/** Replace the pending timer with one `delayMs` from now, or none when auto-review is off. */
function schedule(delayMs: number): void {
	if (runtime.timer) clearTimeout(runtime.timer);
	runtime.timer = null;
	runtime.nextCheckAt = null;

	const settings = readAutoReviewSettings();

	if (!settings.enabled) return;

	runtime.nextCheckAt = new Date(Date.now() + delayMs).toISOString();

	runtime.timer = setTimeout(() => {
		runtime.timer = null;
		void runRound().finally(() => schedule(readAutoReviewSettings().intervalSeconds * 1000));
	}, delayMs);

	runtime.timer.unref?.();
}

/** Start polling, or pick up changed settings: the next round runs shortly, then every interval. */
export function restartWatcher(): void {
	schedule(FIRST_ROUND_MS);
}

/** Run one round now, when auto-review is on, and wait for it. */
export async function checkNow(): Promise<void> {
	if (readAutoReviewSettings().enabled) await runRound();
}

export function autoReviewStatus(settings: AutoReviewSettings = readAutoReviewSettings()): AutoReviewStatus {
	return {
		running: runtime.timer !== null || runtime.round !== null,
		watching: watchedRepos(settings).length,
		lastCheckAt: runtime.lastCheckAt,
		nextCheckAt: runtime.nextCheckAt,
		errors: runtime.errors,
		recent: readWatchState().recent
	};
}
