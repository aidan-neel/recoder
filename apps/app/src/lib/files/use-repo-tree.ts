'use client';

import type { TreeRow } from '@recoder/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '../api/client';
import { failureText } from '../api/http';
import { directoryChain, parentDirectory, treeRows, type DirState } from './tree-rows';

/** A repository's folders as the panel's tree shows them. */
export interface RepoTreeView {
	/** The root's state: its entries load first, and the tree has nothing to show until they do. */
	phase: DirState['phase'] | 'loading';
	/** Why the root did not load. */
	error: string | null;
	rows: TreeRow[];
	/** Opens or shuts a folder; a folder that failed to read is read again. */
	toggle: (directory: string) => void;
	/** Opens a folder and every folder above it. */
	reveal: (directory: string) => void;
	/** Reads the root again after it failed. */
	retry: () => void;
}

const ROOT_ONLY: ReadonlySet<string> = new Set(['']);

/**
 * A repository at `ref` as a lazy tree: a directory is read the first time it opens. The folders above `openPath`
 * open as it changes, so the file being read is always in view; folders the person opened stay open.
 */
export function useRepoTree(repoId: string, ref: string | undefined, openPath: string): RepoTreeView {
	const client = useApi();
	const [dirs, setDirs] = useState<ReadonlyMap<string, DirState>>(new Map());
	const [open, setOpen] = useState<ReadonlySet<string>>(ROOT_ONLY);
	const [shownPath, setShownPath] = useState<string | null>(null);
	const requested = useRef(new Set<string>());

	if (shownPath !== openPath) {
		setShownPath(openPath);
		setOpen((current) => new Set([...current, ...directoryChain(parentDirectory(openPath))]));
	}

	useEffect(() => {
		for (const directory of open) {
			if (requested.current.has(directory)) continue;

			const settle = (state: DirState) => setDirs((current) => new Map(current).set(directory, state));

			requested.current.add(directory);

			client.repoTree(repoId, directory, ref).then(
				(tree) => settle({ phase: 'ready', entries: tree.entries }),
				(error: unknown) => settle({ phase: 'failed', error: failureText(error) })
			);
		}
	}, [client, repoId, ref, open]);

	/** Forgets a failed read, so the next pass of the effect above asks again. */
	const forget = useCallback((directory: string) => {
		requested.current.delete(directory);

		setDirs((current) => {
			const next = new Map(current);

			next.delete(directory);

			return next;
		});
	}, []);

	const reveal = useCallback((directory: string) => {
		setOpen((current) => new Set([...current, ...directoryChain(directory)]));
	}, []);

	const toggle = useCallback(
		(directory: string) => {
			if (dirs.get(directory)?.phase === 'failed') forget(directory);

			setOpen((current) => {
				const next = new Set(current);

				if (!next.delete(directory) || dirs.get(directory)?.phase === 'failed') next.add(directory);

				return next;
			});
		},
		[dirs, forget]
	);

	const rows = useMemo(() => treeRows(dirs, open), [dirs, open]);
	const root = dirs.get('');

	return {
		phase: root?.phase ?? 'loading',
		error: root?.phase === 'failed' ? root.error : null,
		rows,
		toggle,
		reveal,
		retry: () => forget('')
	};
}
