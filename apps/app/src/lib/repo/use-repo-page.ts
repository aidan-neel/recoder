'use client';

import type { RepoOverview } from '@recoder/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useApi, useListStore, useOverviewCache, useSessionCache } from '../api/client';
import { ApiError, failureText, isOffline } from '../api/http';
import { useComposeMode, type ComposeMode } from '../compose/compose-mode';
import type { PullRow } from '../pulls/types';
import { useRowEntries, useWatchList } from '../pulls/use-rows';
import { errorToast } from '../shell/notify';
import { repoName } from '../shell/format';
import { newReviewHref, pullsHref, reposHref } from '../shell/routes';
import { repoPageData } from './repo-page';
import type { RepoPageView } from './types';

/** Where the overview read stands. */
type OverviewState =
	| { phase: 'loading' }
	| { phase: 'ready'; overview: RepoOverview }
	| { phase: 'missing' }
	| { phase: 'failed'; error: string; offline: boolean };

/**
 * The repository's overview. The copy read before (on an earlier visit, or as the pointer rested on the repository's
 * link) paints at once; the page reads it again once per visit and on `retry`. A read that fails keeps a copy already
 * on screen, and with none reads as the failure. An answer for another repository reads as loading.
 */
function useOverview(repoId: string): { state: OverviewState; retry: () => void } {
	const overviews = useOverviewCache();
	const [answer, setAnswer] = useState<{ repoId: string; state: OverviewState } | null>(null);
	const [attempt, setAttempt] = useState(0);

	const retry = useCallback(() => {
		setAnswer(null);
		setAttempt((count) => count + 1);
	}, []);

	useEffect(() => {
		let current = true;
		const settle = (state: OverviewState) => current && setAnswer({ repoId, state });

		overviews.read(repoId).then(
			(overview) => settle({ phase: 'ready', overview }),
			(error: unknown) => {
				if (error instanceof ApiError && error.status === 404) {
					overviews.forget(repoId);
					settle({ phase: 'missing' });
				} else if (!overviews.peek(repoId)) {
					settle({ phase: 'failed', error: failureText(error), offline: isOffline(error) });
				}
			}
		);

		return () => {
			current = false;
		};
	}, [overviews, repoId, attempt]);

	return { state: answer?.repoId === repoId ? answer.state : keptState(overviews.peek(repoId)), retry };
}

/** What the page shows before this visit's read answers: the copy read before, or loading. */
function keptState(kept: RepoOverview | null): OverviewState {
	return kept ? { phase: 'ready', overview: kept } : { phase: 'loading' };
}

/**
 * The repository page: the repository from the tracked list, its open pull requests from the shared list, and its
 * overview from the server. It paints once all three are in, and says so when the repository is not tracked.
 */
export function useRepoPage(repoId: string): RepoPageView {
	useWatchList();

	const { base } = useApi();
	const list = useListStore();
	const sessions = useSessionCache();
	const allEntries = useRowEntries();
	const overview = useOverview(repoId);
	const setComposeMode = useComposeMode((state) => state.setMode);

	const shared = useStore(
		list.state,
		useShallow((state) => ({
			phase: state.phase,
			repos: state.repos,
			error: state.error,
			offline: state.offline,
			starting: state.starting,
			more: state.more.cursors[repoId] !== undefined,
			openTotal: state.list?.openCounts[repoId] ?? null
		}))
	);

	const repo = shared.repos?.find((candidate) => candidate.id === repoId) ?? null;
	const entries = useMemo(() => allEntries.filter((entry) => entry.row.repoId === repoId), [allEntries, repoId]);
	const ready = overview.state.phase === 'ready' ? overview.state.overview : null;

	const data = useMemo(
		() =>
			repo && ready && shared.phase === 'ready'
				? repoPageData({ repo, entries, more: shared.more, openTotal: shared.openTotal, overview: ready, base })
				: null,
		[repo, ready, shared.phase, entries, shared.more, shared.openTotal, base]
	);

	const missing = overview.state.phase === 'missing' || (shared.repos !== null && repo === null);
	const failure = overview.state.phase === 'failed' ? overview.state : null;
	const listFailed = shared.phase === 'failed';

	const retryOverview = overview.retry;

	const retry = useCallback(() => {
		retryOverview();
		if (listFailed) list.refresh();
	}, [retryOverview, listFailed, list]);

	const review = useCallback(
		(row: PullRow) => {
			list.start({ repoId: row.repoId, number: row.number, title: row.title }).catch((error: unknown) => {
				errorToast(failureText(error, 'The review did not start.'));
			});
		},
		[list]
	);

	const warm = useCallback((row: PullRow) => sessions.warm(row.repoId, row.number), [sessions]);

	/** Sets the New screen to this repository in `mode`, before the link takes the person there. */
	const prepare = useCallback(
		(mode: ComposeMode) => {
			list.setComposeRepo(repoId);
			setComposeMode(mode);
		},
		[list, repoId, setComposeMode]
	);

	return {
		phase: phaseOf({ missing, failed: Boolean(failure) || listFailed, ready: data !== null }),
		data,
		name: repo ? repoName(repo.name) : null,
		error: failure?.error ?? shared.error,
		offline: failure?.offline ?? shared.offline,
		retry,
		starting: shared.starting,
		review,
		warm,
		pullsHref: pullsHref(base),
		showPulls: () => list.state.setState({ repoId, filter: 'all', query: '' }),
		newHref: newReviewHref(base),
		reposHref: reposHref(base),
		prepareReview: () => prepare('review'),
		prepareAsk: () => prepare('chat')
	};
}

/** Missing wins over a failure, a failure over loading. */
function phaseOf({
	missing,
	failed,
	ready
}: {
	missing: boolean;
	failed: boolean;
	ready: boolean;
}): RepoPageView['phase'] {
	if (missing) return 'missing';
	if (failed) return 'failed';

	return ready ? 'ready' : 'loading';
}
