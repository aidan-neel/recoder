'use client';

import type { PullCommit } from '@recoder/shared';
import { useCallback, useMemo } from 'react';

import { usePullDiffView, useSessionData } from '../pull/pull-session';
import { loaded } from '../pull/session-state';
import { mayNameCommit, mayNameFile, type ProseSources } from './prose-refs';

const NO_COMMITS: readonly PullCommit[] = [];

interface ProseSourcesView {
	sources: ProseSources;
	/**
	 * True while `markdown` could still gain a badge: it holds inline code and the diff loads, or a hash and the
	 * commits load. Text drawn before then would swap code for a badge under the reader.
	 */
	awaits: (markdown: string | null) => boolean;
}

/**
 * The changed paths and the commits a pull request's prose may name. The diff loads with the page; the commits only
 * once something reads them (the Summary or the Commits tab), so until then prose names files alone. A load that
 * failed has nothing to name and nothing to wait for, so the prose still shows.
 */
export function useProseSources(): ProseSourcesView {
	const diff = usePullDiffView();
	const commitsLoad = useSessionData((data) => data.commits);
	const files = diff.phase === 'ready' ? diff.value.files : null;
	const commits = loaded(commitsLoad) ?? NO_COMMITS;
	const paths = useMemo(() => (files ?? []).map((file) => file.path), [files]);
	const sources = useMemo(() => ({ paths, commits }), [paths, commits]);
	const diffLoading = diff.phase === 'loading';
	const commitsLoading = commitsLoad.phase === 'loading';

	const awaits = useCallback(
		(markdown: string | null) => {
			if (!markdown) return false;

			return (diffLoading && mayNameFile(markdown)) || (commitsLoading && mayNameCommit(markdown));
		},
		[diffLoading, commitsLoading]
	);

	return { sources, awaits };
}
