'use client';

import type { FileDiff } from '@recoder/shared';
import { useCallback, useMemo } from 'react';

import { useSession, useSessionData } from '../pull/pull-session';
import { loaded } from '../pull/session-state';
import { withKey, withoutKey } from '../shell/key-set';
import { treeOrder, treeRows } from './file-tree';
import { guideParts, openBugsByFile } from './guide';
import type { FileTreeView, GuidePart, ViewedFilesView } from './types';
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

/** The file tree beside the diff. */
export function useFileTree(): FileTreeView {
	const session = useSession();
	const files = useDiffFiles();
	const filter = useSessionData((data) => data.treeFilter);
	const closed = useSessionData((data) => data.closedFolders);
	const viewed = useViewedFiles();
	const bugs = useBugsByFile();
	const isViewed = viewed.isViewed;

	const rows = useMemo(
		() => treeRows(files, { filter, closed }, { isViewed, bugs }),
		[files, filter, closed, isViewed, bugs]
	);

	const order = useMemo(() => treeOrder(files), [files]);
	const setFilter = useCallback((next: string) => session.state.setState({ treeFilter: next }), [session]);

	const toggleFolder = useCallback(
		(id: string) =>
			session.state.setState((current) => ({
				closedFolders: current.closedFolders.has(id)
					? withoutKey(current.closedFolders, id)
					: withKey(current.closedFolders, id)
			})),
		[session]
	);

	return useMemo(
		() => ({ rows, filter, setFilter, toggleFolder, order }),
		[rows, filter, setFilter, toggleFolder, order]
	);
}

/** The review plan's parts in plan order; empty until the review planned. */
export function useGuide(): GuidePart[] {
	const assignments = useSessionData((data) => data.progress?.assignments);
	const bugs = useBugsByFile();

	return useMemo(() => guideParts(assignments, bugs), [assignments, bugs]);
}
