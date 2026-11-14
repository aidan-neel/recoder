import type { RepoTreeEntry } from '@recoder/shared';
import type { TreeRow } from '@recoder/ui';

/** What reading one directory came to; a directory not in the map has not answered yet. */
export type DirState = { phase: 'ready'; entries: readonly RepoTreeEntry[] } | { phase: 'failed'; error: string };

/** The directories from the root down to `directory`, each named by its path; the root is the empty string. */
export function directoryChain(directory: string): string[] {
	const parts = directory ? directory.split('/') : [];

	return ['', ...parts.map((_, index) => parts.slice(0, index + 1).join('/'))];
}

/** The directory a file is in; the empty string for one at the root. */
export function parentDirectory(path: string): string {
	return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}

/**
 * The rows of the tree: the entries of every open directory that has loaded, folders first as the server sends
 * them. A symlink or a submodule has no file to read, so it gets no row. A folder still being read shows a
 * spinner, and one whose read failed shows shut, so pressing it reads it again.
 */
export function treeRows(dirs: ReadonlyMap<string, DirState>, open: ReadonlySet<string>): TreeRow[] {
	function rowsUnder(directory: string, depth: number): TreeRow[] {
		const state = dirs.get(directory);

		if (state?.phase !== 'ready') return [];

		return state.entries.flatMap((entry): TreeRow[] => {
			if (entry.kind === 'file') return [{ id: entry.path, label: entry.name, depth, kind: 'file' }];
			if (entry.kind !== 'dir') return [];

			const own = dirs.get(entry.path);
			const isOpen = open.has(entry.path) && own?.phase !== 'failed';

			const row: TreeRow = {
				id: entry.path,
				label: entry.name,
				depth,
				kind: 'folder',
				open: isOpen,
				loading: open.has(entry.path) && own === undefined
			};

			return isOpen ? [row, ...rowsUnder(entry.path, depth + 1)] : [row];
		});
	}

	return rowsUnder('', 0);
}
