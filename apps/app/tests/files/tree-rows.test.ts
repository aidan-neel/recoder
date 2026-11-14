import { describe, expect, test } from 'bun:test';

import { directoryChain, parentDirectory, treeRows, type DirState } from '../../src/lib/files/tree-rows';

const ready = (...entries: { name: string; path: string; kind: 'file' | 'dir' | 'symlink' }[]): DirState => ({
	phase: 'ready',
	entries
});

const DIRS = new Map<string, DirState>([
	['', ready({ name: 'src', path: 'src', kind: 'dir' }, { name: 'README.md', path: 'README.md', kind: 'file' })],
	['src', ready({ name: 'link', path: 'src/link', kind: 'symlink' }, { name: 'a.ts', path: 'src/a.ts', kind: 'file' })]
]);

describe('treeRows', () => {
	test('shows only the folders that are open, and the files inside them one level deeper', () => {
		const rows = treeRows(DIRS, new Set(['', 'src']));

		expect(rows.map((row) => [row.id, row.depth])).toEqual([
			['src', 0],
			['src/a.ts', 1],
			['README.md', 0]
		]);
	});

	test('hides a symlink, which has no file to read', () => {
		expect(treeRows(DIRS, new Set(['', 'src'])).some((row) => row.id === 'src/link')).toBe(false);
	});

	test('shows a shut folder with nothing under it', () => {
		const rows = treeRows(DIRS, new Set(['']));

		expect(rows.map((row) => row.id)).toEqual(['src', 'README.md']);
		expect(rows[0].open).toBe(false);
	});

	test('marks an open folder that has not answered yet as loading', () => {
		const dirs = new Map(DIRS);

		dirs.delete('src');

		expect(treeRows(dirs, new Set(['', 'src']))[0]).toMatchObject({ open: true, loading: true });
	});

	test('shows a folder whose read failed as shut, so pressing it tries again', () => {
		const dirs = new Map(DIRS).set('src', { phase: 'failed', error: 'timeout' });

		expect(treeRows(dirs, new Set(['', 'src']))[0].open).toBe(false);
	});
});

describe('directoryChain', () => {
	test('lists the root and every folder down to the one named', () => {
		expect(directoryChain('a/b/c')).toEqual(['', 'a', 'a/b', 'a/b/c']);
		expect(directoryChain('')).toEqual(['']);
	});
});

describe('parentDirectory', () => {
	test('is the empty string for a file at the root', () => {
		expect(parentDirectory('README.md')).toBe('');
		expect(parentDirectory('src/rate-limit/a.ts')).toBe('src/rate-limit');
	});
});
