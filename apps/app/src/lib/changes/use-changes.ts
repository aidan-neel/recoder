'use client';

import type { FileDiff } from '@recoder/shared';
import type { TreeRow } from '@recoder/ui';
import { useCallback, useMemo } from 'react';

import { useSession, useSessionData } from '../pull/pull-session';
import { loaded } from '../pull/session-state';
import { fileGroups, sideRows, treeOrder } from './file-tree';
import { guideParts, openBugsByFile, openSuggestionsByFile } from './guide';
import type { ChangesNav, FileTreeView, GuidePart, ViewedFilesView } from './types';
import { isViewedAt, toggleViewed, viewedKey, writeViewed } from './viewed-files';

const NO_FILES: FileDiff[] = [];

function useDiffFiles(): FileDiff[] {
	return useSessionData((data) => loaded(data.diff)?.files ?? NO_FILES);
}

/** Open findings per file of the followed review; rebuilt only when the review changes. */
function useBugsByFile(): ReadonlyMap<string, number> {
	const review = useSessionData((data) => data.review);

	return useMemo(() => openBugsByFile(review?.status === 'passed' ? review.findings : []), [review]);
}

/** Which files the person marked as viewed, reset for a file whose diff changed since. */
export function useViewedFiles(): ViewedFilesView {
	const session = useSession();
	const files = useDiffFiles();
	const marks = useSessionData((data) => data.viewed);

	const viewedPaths = useMemo(
		() => new Set(files.filter((file) => isViewedAt(marks, file)).map((file) => file.path)),
		[files, marks]
	);

	const toggle = useCallback(
		(path: string) => {
			const file = files.find((candidate) => candidate.path === path);

			if (!file) return;

			const next = toggleViewed(session.state.getState().viewed, file);

			session.state.setState({ viewed: next });
			writeViewed(viewedKey(session.repoId, session.number), next);
		},
		[files, session]
	);

	return useMemo(
		() => ({
			isViewed: (path: string) => viewedPaths.has(path),
			count: viewedPaths.size,
			total: files.length,
			toggle
		}),
		[viewedPaths, files, toggle]
	);
}

/** The changed files by folder for the file menu, and the order the diff reads in. */
export function useFileTree(): FileTreeView {
	const files = useDiffFiles();
	const viewed = useViewedFiles();
	const bugs = useBugsByFile();
	const isViewed = viewed.isViewed;
	const groups = useMemo(() => fileGroups(files, { isViewed, bugs }), [files, isViewed, bugs]);
	const order = useMemo(() => treeOrder(files), [files]);

	return useMemo(() => ({ groups, order }), [groups, order]);
}

/** The file sidebar's visible rows under its filter, and how to open or shut one of its folders. */
export function useSideRows(query: string): { rows: TreeRow[]; toggleFolder: (path: string) => void } {
	const session = useSession();
	const files = useDiffFiles();
	const closed = useSessionData((data) => data.changesClosed);
	const isViewed = useViewedFiles().isViewed;
	const rows = useMemo(() => sideRows(files, closed, isViewed, query), [files, closed, isViewed, query]);

	const toggleFolder = useCallback(
		(path: string) => {
			const next = new Set(session.state.getState().changesClosed);

			if (!next.delete(path)) next.add(path);

			session.state.setState({ changesClosed: next });
		},
		[session]
	);

	return { rows, toggleFolder };
}

/** The review plan's parts in plan order; empty until the review planned. */
export function useGuide(): GuidePart[] {
	const assignments = useSessionData((data) => data.progress?.assignments);
	const bugs = useBugsByFile();
	const review = useSessionData((data) => data.review);

	return useMemo(
		() =>
			guideParts(assignments, {
				bugs,
				suggestions: openSuggestionsByFile(review?.status === 'passed' ? review.findings : [])
			}),
		[assignments, bugs, review]
	);
}

/** The asks that move the Changes tab; a tab or a tool calls them and the tab acts on them when it is shown. */
export function useChangesNav(): ChangesNav {
	const session = useSession();

	return useMemo(
		() => ({
			goTo: (path, line = null, findingId = null) =>
				session.state.setState({ changesTarget: { path, line, findingId, done: false } }),
			foldAll: (open) => session.state.setState({ changesFold: { open } })
		}),
		[session]
	);
}
