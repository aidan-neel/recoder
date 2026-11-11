import type { Repo } from '@recoder/shared';
import { db } from '../../store';
import { hostOfRepoUrl } from '../gitlab-host';
import { parseSlug } from '../providers';
import { decideEvent, readWatchState, writeWatchState, type PullEvent, type WatchedPull } from './cursor';
import { readAutoReviewSettings } from './settings';
import { reviewHistory, startAutoReview } from './start';
import { withWatchState } from './state-queue';

/** One pull request event a webhook delivered, with every URL the payload gives for its repository. */
export interface PullHook {
	repoUrls: string[];
	pull: WatchedPull;
	event: PullEvent;
}

/** The webhook's answer; the forge shows it in its delivery log. */
export interface HookOutcome {
	received: true;
	reviewCreated: boolean;
	reviewId?: string;
	reason?: string;
}

/** `host/namespace/path` in lower case, so `https://…`, `…/x.git` and `git@host:…` of one repository agree. */
function repoKey(url: string): string | null {
	try {
		const host = hostOfRepoUrl(url)?.replace(/:\d+$/, '');

		return host ? `${host}/${parseSlug(url).toLowerCase()}` : null;
	} catch {
		return null;
	}
}

/** The tracked repository any of the payload's URLs points at. */
async function findTrackedRepo(urls: string[]): Promise<Repo | undefined> {
	const keys = new Set(urls.map(repoKey).filter((key): key is string => key !== null));

	return (await db.repos.list()).find((repo) => {
		const key = repoKey(repo.url);

		return key !== null && keys.has(key);
	});
}

function skipped(reason: string): HookOutcome {
	return { received: true, reviewCreated: false, reason };
}

/**
 * Run a webhook event through the watcher's own settings and rules, starting
 * the review the same way. The event moves the pull request's cursor, so the
 * poller won't start a second review for the same comment or commit.
 */
export async function handlePullHook(hook: PullHook): Promise<HookOutcome> {
	const settings = readAutoReviewSettings();

	if (!settings.enabled) return skipped('auto-review is off');

	const repo = await findTrackedRepo(hook.repoUrls);

	if (!repo) return skipped('repo not tracked');
	if (settings.excludedRepoIds.includes(repo.id)) return skipped('repo excluded from auto-review');

	return withWatchState(async () => {
		const now = new Date().toISOString();
		const state = readWatchState();
		const repoCursor = (state.repos[repo.id] ??= { checkedAt: now, pulls: {} });

		const decision = decideEvent({
			settings,
			cursor: repoCursor.pulls[hook.pull.number],
			pull: hook.pull,
			event: hook.event,
			...(await reviewHistory(repo.id, hook.pull)),
			now
		});

		repoCursor.pulls[hook.pull.number] = decision.cursor;

		let outcome = skipped('nothing to review');

		if (decision.trigger) {
			try {
				const started = await startAutoReview({
					repo,
					pull: hook.pull,
					trigger: decision.trigger,
					source: 'webhook',
					postResults: settings.postResults
				});

				state.recent.unshift(started);
				outcome = { received: true, reviewCreated: true, reviewId: started.reviewId };
			} catch (err) {
				outcome = skipped(err instanceof Error ? err.message : 'could not start the review');
			}
		}

		writeWatchState(state);

		return outcome;
	});
}
