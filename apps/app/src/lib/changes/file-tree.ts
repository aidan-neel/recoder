import type { FileDiff } from '@recoder/shared';

import type { FileChange, TreeRow } from './types';

/** What each file row shows beyond the diff: whether it was viewed and its open findings. */
export interface FileMarks {
	isViewed: (path: string) => boolean;
	bugs: ReadonlyMap<string, number>;
}

/** How the tree is shown: the search text and the folders the person closed. */
export interface TreeShape {
	filter: string;
	closed: ReadonlySet<string>;
}

interface Folder {
	path: string;
	folders: Map<string, Folder>;
	files: FileDiff[];
}

type FileRow = Extract<TreeRow, { kind: 'file' }>;

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

/** A folder with a lone child folder and no files joins it, so `apps/server/src` reads as one row. */
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

function byName(a: string, b: string): number {
	return a.localeCompare(b);
}

function sortedFolders(at: Folder): Folder[] {
	return [...at.folders.values()].sort((a, b) => byName(a.path, b.path));
}

function sortedFiles(at: Folder): FileDiff[] {
	return [...at.files].sort((a, b) => byName(nameOf(a.path), nameOf(b.path)));
}

function countFiles(at: Folder): number {
	return at.files.length + sortedFolders(at).reduce((sum, child) => sum + countFiles(child), 0);
}

function fileRow(file: FileDiff, depth: number, marks: FileMarks): FileRow {
	return {
		kind: 'file',
		id: file.path,
		name: nameOf(file.path),
		depth,
		additions: file.additions,
		deletions: file.deletions,
		change: fileChange(file),
		viewed: marks.isViewed(file.path),
		bugs: marks.bugs.get(file.path) ?? 0
	};
}

/** The rows under a folder: its folders first, then its files, each by name; a closed folder hides what is in it. */
function rowsUnder(at: Folder, depth: number, closed: ReadonlySet<string>, marks: FileMarks): TreeRow[] {
	const folders = sortedFolders(at).flatMap((child): TreeRow[] => {
		const { folder: end, label } = joined(child);
		const open = !closed.has(end.path);
		const row: TreeRow = { kind: 'folder', id: end.path, label, depth, open, files: countFiles(end) };

		return open ? [row, ...rowsUnder(end, depth + 1, closed, marks)] : [row];
	});

	return [...folders, ...sortedFiles(at).map((file) => fileRow(file, depth, marks))];
}

/** The file tree's visible rows: files whose path holds the filter text, in folders the person did not close. */
export function treeRows(files: FileDiff[], shape: TreeShape, marks: FileMarks): TreeRow[] {
	const needle = shape.filter.trim().toLowerCase();
	const shown = needle ? files.filter((file) => file.path.toLowerCase().includes(needle)) : files;

	return rowsUnder(nest(shown), 0, shape.closed, marks);
}

/** The paths in tree order with every folder open: the order to read the diff in. */
export function treeOrder(files: FileDiff[]): string[] {
	const none: FileMarks = { isViewed: () => false, bugs: new Map() };

	return rowsUnder(nest(files), 0, new Set(), none).flatMap((row) => (row.kind === 'file' ? [row.id] : []));
}
