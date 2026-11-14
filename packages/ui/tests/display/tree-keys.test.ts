import { describe, expect, test } from 'bun:test';

import { treeKeyAction, type TreeRow } from '../../src/components/display/tree-keys';

const ROWS: TreeRow[] = [
	{ id: 'src', label: 'src', depth: 0, kind: 'folder', open: true },
	{ id: 'src/lib', label: 'lib', depth: 1, kind: 'folder', open: false },
	{ id: 'src/index.ts', label: 'index.ts', depth: 1, kind: 'file' },
	{ id: 'README.md', label: 'README.md', depth: 0, kind: 'file' }
];

describe('treeKeyAction', () => {
	test('ArrowDown stops at the last row', () => {
		expect(treeKeyAction(ROWS, 'src', 'ArrowDown')).toEqual({ type: 'focus', id: 'src/lib' });
		expect(treeKeyAction(ROWS, 'README.md', 'ArrowDown')).toEqual({ type: 'focus', id: 'README.md' });
	});

	test('Home and End jump to the ends', () => {
		expect(treeKeyAction(ROWS, 'src/lib', 'End')).toEqual({ type: 'focus', id: 'README.md' });
		expect(treeKeyAction(ROWS, 'src/lib', 'Home')).toEqual({ type: 'focus', id: 'src' });
	});

	test('ArrowRight opens a shut folder, then steps into an open one', () => {
		expect(treeKeyAction(ROWS, 'src/lib', 'ArrowRight')).toEqual({ type: 'toggle', id: 'src/lib' });
		expect(treeKeyAction(ROWS, 'src', 'ArrowRight')).toEqual({ type: 'focus', id: 'src/lib' });
	});

	test('ArrowRight on a file does nothing', () => {
		expect(treeKeyAction(ROWS, 'README.md', 'ArrowRight')).toBeNull();
	});

	test('ArrowLeft shuts an open folder, then climbs to the folder that holds the row', () => {
		expect(treeKeyAction(ROWS, 'src', 'ArrowLeft')).toEqual({ type: 'toggle', id: 'src' });
		expect(treeKeyAction(ROWS, 'src/index.ts', 'ArrowLeft')).toEqual({ type: 'focus', id: 'src' });
		expect(treeKeyAction(ROWS, 'README.md', 'ArrowLeft')).toBeNull();
	});

	test('Enter toggles a folder and chooses a file', () => {
		expect(treeKeyAction(ROWS, 'src/lib', 'Enter')).toEqual({ type: 'toggle', id: 'src/lib' });
		expect(treeKeyAction(ROWS, 'src/index.ts', ' ')).toEqual({ type: 'select', id: 'src/index.ts' });
	});

	test('a row that is not in the list gets no action', () => {
		expect(treeKeyAction(ROWS, 'gone', 'ArrowDown')).toBeNull();
	});
});
