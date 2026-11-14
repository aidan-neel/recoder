/** One visible row of a `Tree`: a folder that opens, or a file that is chosen. */
export interface TreeRow {
	id: string;
	label: string;
	/** How many folders deep the row sits; the first level is 0. */
	depth: number;
	kind: 'folder' | 'file';
	/** Whether a folder shows what is in it. */
	open?: boolean;
	/** Whether a folder is still reading what is in it. */
	loading?: boolean;
}

/** What a key does to the tree: move the focus, open or shut a folder, or choose a file. */
export type TreeKeyAction =
	{ type: 'focus'; id: string } | { type: 'toggle'; id: string } | { type: 'select'; id: string };

/** The nearest row above `index` that is shallower: the folder that holds it. */
function parentIndex(rows: readonly TreeRow[], index: number): number {
	for (let at = index - 1; at >= 0; at -= 1) {
		if (rows[at].depth < rows[index].depth) return at;
	}

	return -1;
}

/** Where a key that moves in the list lands, or -1 when the key is not one. */
function movedIndex(key: string, index: number, last: number): number {
	if (key === 'ArrowDown') return Math.min(index + 1, last);
	if (key === 'ArrowUp') return Math.max(index - 1, 0);
	if (key === 'Home') return 0;
	if (key === 'End') return last;

	return -1;
}

/** Right opens a shut folder, then steps into an open one. */
function rightKey(rows: readonly TreeRow[], index: number): TreeKeyAction | null {
	const row = rows[index];

	if (row.kind !== 'folder') return null;
	if (!row.open) return { type: 'toggle', id: row.id };

	const child = rows[index + 1];

	return child && child.depth > row.depth ? { type: 'focus', id: child.id } : null;
}

/** Left shuts an open folder, then steps out to the folder that holds the row. */
function leftKey(rows: readonly TreeRow[], index: number): TreeKeyAction | null {
	const row = rows[index];

	if (row.kind === 'folder' && row.open) return { type: 'toggle', id: row.id };

	const parent = parentIndex(rows, index);

	return parent === -1 ? null : { type: 'focus', id: rows[parent].id };
}

/**
 * What `key` does when the row `id` has focus, by the tree pattern: arrows
 * move, Right and Left open, shut and climb, Home and End jump, Enter and
 * Space open a folder or choose a file. Null when the key does nothing here.
 */
export function treeKeyAction(rows: readonly TreeRow[], id: string, key: string): TreeKeyAction | null {
	const index = rows.findIndex((row) => row.id === id);

	if (index === -1) return null;

	const moved = movedIndex(key, index, rows.length - 1);

	if (moved !== -1) return { type: 'focus', id: rows[moved].id };
	if (key === 'ArrowRight') return rightKey(rows, index);
	if (key === 'ArrowLeft') return leftKey(rows, index);
	if (key !== 'Enter' && key !== ' ') return null;

	return { type: rows[index].kind === 'folder' ? 'toggle' : 'select', id };
}
