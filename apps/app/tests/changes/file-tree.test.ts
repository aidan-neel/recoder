import { describe, expect, test } from 'bun:test';
import type { FileDiff } from '@recoder/shared';

import { treeOrder, treeRows, type FileMarks } from '../../src/lib/changes/file-tree';
import { addedHunk } from '../fixtures';

function file(path: string): FileDiff {
	return { path, additions: 2, deletions: 0, hunks: [addedHunk(1, 2)] };
}

const FILES = [
	file('README.md'),
	file('apps/server/src/routes/pulls.ts'),
	file('apps/server/src/index.ts'),
	file('apps/server/src/agents/run.ts')
];

const MARKS: FileMarks = { isViewed: (path) => path === 'README.md', bugs: new Map([['apps/server/src/index.ts', 2]]) };

function labels(files: FileDiff[], filter = '', closed: ReadonlySet<string> = new Set()): string[] {
	return treeRows(files, { filter, closed }, MARKS).map((row) => (row.kind === 'folder' ? `${row.label}/` : row.name));
}

describe('treeRows', () => {
	test('a chain of single-child folders reads as one row, folders before files, each by name', () => {
		expect(labels(FILES)).toEqual([
			'apps/server/src/',
			'agents/',
			'run.ts',
			'routes/',
			'pulls.ts',
			'index.ts',
			'README.md'
		]);
	});

	test('a joined folder row counts every file under it and carries the full path as its id', () => {
		const [top] = treeRows(FILES, { filter: '', closed: new Set() }, MARKS);

		expect(top).toEqual({
			kind: 'folder',
			id: 'apps/server/src',
			label: 'apps/server/src',
			depth: 0,
			open: true,
			files: 3
		});
	});

	test('file rows carry the viewed mark, open findings and how the file changed', () => {
		const rows = treeRows(FILES, { filter: '', closed: new Set() }, MARKS);

		expect(rows.find((row) => row.id === 'README.md')).toMatchObject({ viewed: true, bugs: 0, change: 'modified' });

		expect(rows.find((row) => row.id === 'apps/server/src/index.ts')).toMatchObject({
			viewed: false,
			bugs: 2,
			depth: 1
		});
	});

	test('a closed folder hides what is in it', () => {
		expect(labels(FILES, '', new Set(['apps/server/src']))).toEqual(['apps/server/src/', 'README.md']);
	});

	test('the filter keeps files whose path holds the text, ignoring case, and drops empty folders', () => {
		expect(labels(FILES, 'ROUTES')).toEqual(['apps/server/src/routes/', 'pulls.ts']);
	});
});

describe('treeOrder', () => {
	test('reads the files in tree order with every folder open', () => {
		expect(treeOrder(FILES)).toEqual([
			'apps/server/src/agents/run.ts',
			'apps/server/src/routes/pulls.ts',
			'apps/server/src/index.ts',
			'README.md'
		]);
	});
});
