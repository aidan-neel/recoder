'use client';

import type { PullCommit } from '@recoder/shared';
import { useCallback, useMemo } from 'react';

import { usePullCommitsView, usePullDiffView } from '../pull/pull-session';
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
 * The changed paths and the commits the Summary's prose may name. It reads the commits, which only the Commits tab
 * read before. A load that failed has nothing to name and nothing to wait for, so the prose still shows.
 */
export function useProseSources(): ProseSourcesView {
	const diff = usePullDiffView();
	const commitsView = usePullCommitsView();
	const files = diff.phase === 'ready' ? diff.value.files : null;
	const commits = commitsView.phase === 'ready' ? commitsView.value : NO_COMMITS;
	const paths = useMemo(() => (files ?? []).map((file) => file.path), [files]);
	const sources = useMemo(() => ({ paths, commits }), [paths, commits]);
	const diffLoading = diff.phase === 'loading';
	const commitsLoading = commitsView.phase === 'loading';

	const awaits = useCallback(
		(markdown: string | null) => {
			if (!markdown) return false;

			return (diffLoading && mayNameFile(markdown)) || (commitsLoading && mayNameCommit(markdown));
		},
		[diffLoading, commitsLoading]
	);

	return { sources, awaits };
}
