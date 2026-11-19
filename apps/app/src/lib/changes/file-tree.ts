import type { FileDiff } from '@recoder/shared';
import type { TreeRow } from '@recoder/ui';

import type { FileChange, FileEntry, FileGroup } from './types';

/** What each file shows beyond the diff: whether it was viewed and its open findings. */
export interface FileMarks {
	isViewed: (path: string) => boolean;
	bugs: ReadonlyMap<string, number>;
}

interface Folder {
	path: string;
	folders: Map<string, Folder>;
	files: FileDiff[];
}

/** How a file changed: every hunk starts from nothing (added), or leaves nothing (deleted). */
function fileChange(file: FileDiff): FileChange {
	if (file.hunks.length === 0) return 'modified';
	if (file.hunks.every((hunk) => hunk.oldStart === 0 && hunk.oldCount === 0)) return 'added';
	if (file.hunks.every((hunk) => hunk.newStart === 0 && hunk.newCount === 0)) return 'deleted';

	return 'modified';
}

function folder(path: string): Folder {
	return { path, folders: new Map(), files: [] };
}

function nameOf(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

/** The folder a path sits in; empty at the top of the repository. */
function folderOf(path: string): string {
	return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}

/** The files placed in nested folders by their paths. */
function nest(files: FileDiff[]): Folder {
	const root = folder('');

	for (const file of files) {
		const parts = file.path.split('/');
		let at = root;

		for (const part of parts.slice(0, -1)) {
			const path = at.path ? `${at.path}/${part}` : part;
			const next = at.folders.get(part) ?? folder(path);

			at.folders.set(part, next);
			at = next;
		}

		at.files.push(file);
	}

	return root;
}

function byName(a: string, b: string): number {
	return a.localeCompare(b);
}

function sortedFolders(at: Folder): Folder[] {
	return [...at.folders.values()].sort((a, b) => byName(a.path, b.path));
}

function sortedFiles(at: Folder): FileDiff[] {
	return [...at.files].sort((a, b) => byName(nameOf(a.path), nameOf(b.path)));
}

/** The files under a folder: its folders' first, each by path, then its own, each by name. */
function filesUnder(at: Folder): FileDiff[] {
	return [...sortedFolders(at).flatMap(filesUnder), ...sortedFiles(at)];
}

/** A folder with a lone child folder and no files of its own joins it, so `apps/server/src` reads as one row. */
function joined(start: Folder): { folder: Folder; label: string } {
	let at = start;
	let label = nameOf(start.path);

	while (at.files.length === 0 && at.folders.size === 1) {
		const [only] = at.folders.values();

		label = `${label}/${nameOf(only.path)}`;
		at = only;
	}

	return { folder: at, label };
}

/**
 * The file sidebar's visible rows, in the diff's order: folders first, each by path, then files by name. A closed
 * folder hides what is in it, and a viewed file is muted.
 */
export function sideRows(
	files: FileDiff[],
	closed: ReadonlySet<string>,
	isViewed: (path: string) => boolean
): TreeRow[] {
	function rowsUnder(at: Folder, depth: number): TreeRow[] {
		const folders = sortedFolders(at).flatMap((child): TreeRow[] => {
			const { folder: end, label } = joined(child);
			const open = !closed.has(end.path);
			const row: TreeRow = { kind: 'folder', id: end.path, label, depth, open };

			return open ? [row, ...rowsUnder(end, depth + 1)] : [row];
		});

		const own = sortedFiles(at).map((file): TreeRow => ({
			kind: 'file',
			id: file.path,
			label: nameOf(file.path),
			depth,
			muted: isViewed(file.path)
		}));

		return [...folders, ...own];
	}

	return rowsUnder(nest(files), 0);
}

/** The paths in tree order, folders before files: the order to read the diff in. */
export function treeOrder(files: FileDiff[]): string[] {
	return filesUnder(nest(files)).map((file) => file.path);
}

function entry(file: FileDiff, marks: FileMarks): FileEntry {
	return {
		path: file.path,
		name: nameOf(file.path),
		additions: file.additions,
		deletions: file.deletions,
		change: fileChange(file),
		viewed: marks.isViewed(file.path),
		bugs: marks.bugs.get(file.path) ?? 0
	};
}

/** The files in tree order, gathered under the folder each sits in, so the file menu reads like the tree. */
export function fileGroups(files: FileDiff[], marks: FileMarks): FileGroup[] {
	const groups = new Map<string, FileEntry[]>();

	for (const file of filesUnder(nest(files))) {
		const at = folderOf(file.path);

		groups.set(at, [...(groups.get(at) ?? []), entry(file, marks)]);
	}

	return [...groups].map(([path, entries]) => ({ folder: path, files: entries }));
}
