import { latestReviews, type Repo } from '@recoder/shared';
import { db } from '../../store';
import { GhError } from '../cli';
import { pullEntry } from './cached';
import { logForgeFailure } from './failure';
import { pullStates } from './pull-states';

/** How often the sweep runs: a pull request merged on the forge outside Recoder settles within a few minutes. */
export const SWEEP_INTERVAL_MS = 5 * 60_000;

/** Pull requests checked per round, so a round stays light for the forge. */
const SWEEP_LIMIT = 20;

/** A pull request seen this recently needs no check. A closed one can wait an hour; it can still reopen. */
const RECHECK_MS = 5 * 60_000;
const CLOSED_RECHECK_MS = 60 * 60_000;

/**
 * One pass over the newest review of each pull request in a connected
 * repository: read the state of each whose record is missing or stale.
 * `merged` is final and never re-checked; `closed` is re-checked on the
 * slower clock since it can reopen. A forge failure — a rate limit, an
 * unreachable forge, a missing login — skips that pull request and records
 * nothing, so the next round tries it again. A pull request the forge has
 * no record of waits on the closed clock, so one never opened (or deleted)
 * is not asked about every round.
 */
export async function sweepPullStates(now = Date.now()): Promise<void> {
	const [repos, reviews, records] = await Promise.all([db.repos.list(), db.reviews.summaries(), pullStates.list()]);

	const connected = new Map(repos.map((repo) => [repo.id, repo]));
	const known = new Map(records.map((record) => [record.id, record]));
	const candidates: { key: string; repo: Repo; n: number; updatedAt: string }[] = [];

	for (const [key, review] of latestReviews(reviews)) {
		const repo = connected.get(review.repoId);

		if (repo) candidates.push({ key, repo, n: review.prNumber, updatedAt: review.updatedAt });
	}

	candidates.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

	let checked = 0;

	for (const { key, repo, n } of candidates) {
		if (checked >= SWEEP_LIMIT) break;

		const record = known.get(key);

		if (record?.state === 'merged') continue;
		if (record && now - Date.parse(record.checkedAt) < (record.state === 'closed' ? CLOSED_RECHECK_MS : RECHECK_MS))
			continue;
		if (recentlyMissing(key, now)) continue;

		checked++;

		try {
			await pullEntry(repo, n);
			missingSince.delete(key);
		} catch (error) {
			handleSweepFailure({ key, repo, n, now }, error);
		}
	}
}

/**
 * When the forge last said it has no such pull request, by key. Kept in
 * memory: after a restart each is asked once more, which is cheap.
 */
const missingSince = new Map<string, number>();

function recentlyMissing(key: string, now: number): boolean {
	const since = missingSince.get(key);

	return since !== undefined && now - since < CLOSED_RECHECK_MS;
}

/** Remembers a pull request the forge has no record of and logs it once; logs any other failure every time. */
function handleSweepFailure(check: { key: string; repo: Repo; n: number; now: number }, error: unknown): void {
	const context = `the pull state sweep checking pull request ${check.n} for repo ${check.repo.id}`;

	if (!(error instanceof GhError) || error.kind !== 'not-found') {
		logForgeFailure(context, error);

		return;
	}

	if (!missingSince.has(check.key)) logForgeFailure(`${context} (re-checked hourly)`, error);

	missingSince.set(check.key, check.now);
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Run the sweep now, then every few minutes while the server runs. The interval never holds the process open. */
export function startPullSweep(): void {
	stopPullSweep();

	const run = () => {
		void sweepPullStates().catch((error: unknown) => console.error('[pulls] the state sweep failed', error));
	};

	run();

	timer = setInterval(run, SWEEP_INTERVAL_MS);
	timer.unref();
}

/** Stops the sweep `startPullSweep` began, so starting again never runs two. */
function stopPullSweep(): void {
	if (timer !== null) clearInterval(timer);
	timer = null;
}
