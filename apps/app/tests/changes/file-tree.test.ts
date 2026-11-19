import { describe, expect, test } from 'bun:test';
import type { FileDiff } from '@recoder/shared';

import { fileGroups, sideRows, treeOrder, type FileMarks } from '../../src/lib/changes/file-tree';
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

describe('treeOrder', () => {
	test('reads the files in tree order: folders first, each by path, then files by name', () => {
		expect(treeOrder(FILES)).toEqual([
			'apps/server/src/agents/run.ts',
			'apps/server/src/routes/pulls.ts',
			'apps/server/src/index.ts',
			'README.md'
		]);
	});
});

describe('sideRows', () => {
	test('joins a chain of lone folders into one row and lists the rows in the diff order', () => {
		const rows = sideRows(FILES, new Set(), MARKS.isViewed);

		expect(rows.map((row) => [row.depth, row.label])).toEqual([
			[0, 'apps/server/src'],
			[1, 'agents'],
			[2, 'run.ts'],
			[1, 'routes'],
			[2, 'pulls.ts'],
			[1, 'index.ts'],
			[0, 'README.md']
		]);

		expect(rows.filter((row) => row.kind === 'file').map((row) => row.id)).toEqual(treeOrder(FILES));
	});

	test('a closed folder hides what is in it, and a viewed file is muted', () => {
		const rows = sideRows(FILES, new Set(['apps/server/src']), MARKS.isViewed);

		expect(rows).toEqual([
			{ kind: 'folder', id: 'apps/server/src', label: 'apps/server/src', depth: 0, open: false },
			{ kind: 'file', id: 'README.md', label: 'README.md', depth: 0, muted: true }
		]);
	});
});

describe('fileGroups', () => {
	test('gathers the files in tree order under their folder, with the top level last', () => {
		expect(fileGroups(FILES, MARKS).map((group) => [group.folder, group.files.map((entry) => entry.name)])).toEqual([
			['apps/server/src/agents', ['run.ts']],
			['apps/server/src/routes', ['pulls.ts']],
			['apps/server/src', ['index.ts']],
			['', ['README.md']]
		]);
	});

	test('each file carries the viewed mark, its open findings and how it changed', () => {
		const entries = fileGroups(FILES, MARKS).flatMap((group) => group.files);

		expect(entries.find((entry) => entry.path === 'README.md')).toMatchObject({
			viewed: true,
			bugs: 0,
			change: 'modified'
		});

		expect(entries.find((entry) => entry.path === 'apps/server/src/index.ts')).toMatchObject({
			viewed: false,
			bugs: 2
		});
	});
});
