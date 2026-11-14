'use client';

import type { PrCheck, PullCheckTally, Review, ReviewListItem } from '@recoder/shared';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { useListStore, useSessionCache } from '../api/client';
import { openCounts, shortRepoName } from '../pulls/pull-rows';
import { chosenMethod, mergeBlock } from './merge';
import type { Session } from './session';
import { loaded, type Load, type SessionData } from './session-state';
import type {
	Loadable,
	MergeView,
	PullChecksView,
	PullCommitsView,
	PullConversationView,
	PullDiffView,
	PullPageView
} from './types';

const SessionContext = createContext<Session | null>(null);

/** One pull request's page: everything under it reads and writes this pull request's session. */
export function PullSessionProvider({
	repoId,
	number,
	children
}: {
	repoId: string;
	number: number;
	children: ReactNode;
}) {
	const sessions = useSessionCache();
	const session = useMemo(() => sessions.get(repoId, number), [sessions, repoId, number]);

	useEffect(() => session.open(), [session]);

	return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/** The session of the nearest `PullSessionProvider`. */
export function useSession(): Session {
	const session = useContext(SessionContext);

	if (!session) throw new Error('This hook needs a PullSessionProvider above it.');

	return session;
}

/** A slice of the session's data; the component re-renders only when the slice changes. */
export function useSessionData<Slice>(select: (data: SessionData) => Slice): Slice {
	return useStore(useSession().state, select);
}

/** A part as the tabs read it: one not asked for yet reads as loading, and a failure offers its retry. */
function loadable<Value>(load: Load<Value>, retry: () => void): Loadable<Value> {
	if (load.phase === 'idle' || load.phase === 'loading') return { phase: 'loading' };
	if (load.phase === 'failed') return { phase: 'failed', error: load.error, retry };

	return load;
}

/** Open findings of a finished review; null until a review finished. */
function openBugCount(review: ReviewListItem | null): number | null {
	if (review?.status !== 'passed') return null;

	const counts = openCounts(review);

	return counts.bugs + counts.suggestions;
}

/** The review whose findings the page counts: the one read in full when it is the page's newest, else the page's. */
function countedReview(full: Review | null, listed: ReviewListItem | null): ReviewListItem | null {
	return full && (!listed || full.id === listed.id || full.createdAt > listed.createdAt) ? full : listed;
}

/** The pull request page above its tabs. */
export function usePullPageView(): PullPageView {
	const session = useSession();
	const page = useSessionData((data) => data.page);
	const review = useSessionData((data) => data.review);
	const files = useSessionData((data) => loaded(data.diff)?.files.length ?? null);
	const commits = useSessionData((data) => loaded(data.commits)?.length ?? null);
	const repos = useStore(useListStore().state, (data) => data.repos);
	const value = page.value;

	return useMemo(
		() => ({
			phase: page.phase,
			error: page.error,
			offline: page.offline,
			page: value,
			repoName: shortRepoName(repos, session.repoId),
			counts: {
				files: files ?? value?.pull.changedFiles ?? null,
				bugs: openBugCount(countedReview(review, value?.review ?? null)),
				commits: value?.status.commits ?? commits
			},
			refresh: () => void session.pages.loadPage()
		}),
		[page, value, repos, session, files, review, commits]
	);
}

/** The diff of the Changes tab; it loads with the page. */
export function usePullDiffView(): PullDiffView {
	const session = useSession();
	const diff = useSessionData((data) => data.diff);

	return useMemo(() => loadable(diff, () => void session.pages.loadDiff()), [diff, session]);
}

/** The Commits tab; it loads the first time it is used. */
export function usePullCommitsView(): PullCommitsView {
	const session = useSession();
	const commits = useSessionData((data) => data.commits);

	useEffect(() => {
		if (session.state.getState().commits.phase === 'idle') void session.pages.loadCommits();
	}, [session]);

	return useMemo(() => loadable(commits, () => void session.pages.loadCommits()), [commits, session]);
}

const CHECK_RANK: Record<PrCheck['state'], number> = { failed: 0, pending: 1, running: 1, passed: 2, skipped: 2 };

function tallyOf(checks: PrCheck[]): PullCheckTally {
	return {
		failed: checks.filter((check) => CHECK_RANK[check.state] === 0).length,
		pending: checks.filter((check) => CHECK_RANK[check.state] === 1).length,
		passed: checks.filter((check) => CHECK_RANK[check.state] === 2).length
	};
}

function outcomeOf(tally: PullCheckTally): PullChecksView['outcome'] {
	if (tally.failed > 0) return 'failed';
	if (tally.pending > 0) return 'pending';

	return 'passed';
}

const NO_TALLY: PullCheckTally = { passed: 0, failed: 0, pending: 0 };

/** Checks as the merge bar shows them, before they or the page answered. */
function checksPhase(data: Pick<SessionData, 'page' | 'checks'>): PullChecksView['phase'] {
	const page = data.page.value;

	if (!page) return data.page.phase === 'loading' ? 'loading' : 'none';
	if (!page.capabilities.checks) return 'none';
	if (data.checks.phase === 'failed') return 'failed';
	if (data.checks.phase !== 'ready') return 'loading';

	return data.checks.value.length > 0 ? 'ready' : 'none';
}

/** The head commit's checks; they read again while one runs and the page is visible. */
export function usePullChecksView(): PullChecksView {
	const page = useSessionData((data) => data.page);
	const checks = useSessionData((data) => data.checks);

	return useMemo(() => {
		const phase = checksPhase({ page, checks });
		const list = [...(loaded(checks) ?? [])].sort((a, b) => CHECK_RANK[a.state] - CHECK_RANK[b.state]);
		const tally = phase === 'ready' ? tallyOf(list) : NO_TALLY;

		return {
			phase,
			checks: phase === 'ready' ? list : [],
			tally,
			outcome: phase === 'ready' ? outcomeOf(tally) : 'none',
			error: checks.phase === 'failed' ? checks.error : null
		};
	}, [page, checks]);
}

/** The pull request's conversation on its forge; it loads the first time it is used. */
export function usePullConversationView(): PullConversationView {
	const session = useSession();
	const page = useSessionData((data) => data.page.value);
	const conversation = useSessionData((data) => data.conversation);
	const posting = useSessionData((data) => data.posting);
	const comments = page?.capabilities.comments ?? null;

	useEffect(() => {
		if (comments && session.state.getState().conversation.phase === 'idle') void session.pages.loadConversation();
	}, [comments, session]);

	return useMemo(() => {
		const entries = loaded(conversation) ?? [];
		const error = conversation.phase === 'failed' ? conversation.error : null;
		const post = session.pages.postComment;

		if (comments === false) return { phase: 'off', entries: [], error: null, post, posting };
		if (error) return { phase: 'failed', entries, error, post, posting };

		return { phase: conversation.phase === 'ready' ? 'ready' : 'loading', entries, error, post, posting };
	}, [comments, conversation, posting, session]);
}

/** Merging from the merge bar. */
export function useMergeView(): MergeView {
	const session = useSession();
	const page = useSessionData((data) => data.page.value);
	const merge = useSessionData((data) => data.merge);

	return useMemo(
		() => ({
			methods: page?.capabilities.mergeMethods ?? [],
			method: page ? chosenMethod(page, merge.method) : null,
			setMethod: session.merge.setMethod,
			block: page ? mergeBlock(page) : 'unavailable',
			phase: merge.phase,
			error: merge.error,
			merge: session.merge.merge
		}),
		[page, merge, session]
	);
}
