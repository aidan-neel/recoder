import { describe, expect, test } from 'bun:test';
import type { DiffGuide, DiffHunk, FileDiff } from '@recoder/shared';

import { guideChapters, hunkBugs, hunkId, hunkWhere } from '../../src/lib/changes/chapters';

/** A hunk of `count` added lines at `start` on the new side, with as many old lines replaced. */
function hunk(start: number, count = 2): DiffHunk {
	const lines = Array.from({ length: count }, (_, index) => ({
		type: 'add' as const,
		oldNo: null,
		newNo: start + index,
		text: `line ${start + index}`
	}));

	return { header: '', oldStart: start, oldCount: count, newStart: start, newCount: count, lines };
}

function file(path: string, ...hunks: DiffHunk[]): FileDiff {
	return { path, additions: 0, deletions: 0, hunks };
}

const A = file('src/a.ts', hunk(1), hunk(40));
const B = file('src/b.ts', hunk(5));
const RENAMED: FileDiff = { ...file('src/new.ts'), status: 'renamed', oldPath: 'src/old.ts' };
const FILES = [A, B, RENAMED];

const ID = {
	a1: hunkId('src/a.ts', A.hunks[0]),
	a2: hunkId('src/a.ts', A.hunks[1]),
	b: hunkId('src/b.ts', B.hunks[0])
};

function guide(groups: DiffGuide['groups']): DiffGuide {
	return { source: 'model', groups };
}

/** A's second hunk alone in chapter one, then B and A's first hunk in chapter two. */
const SPLIT = guide([
	{ id: 'one', title: 'One', hunks: [{ id: ID.a2, file: 'src/a.ts' }] },
	{
		id: 'two',
		title: 'Two',
		hunks: [
			{ id: ID.b, file: 'src/b.ts' },
			{ id: ID.a1, file: 'src/a.ts' }
		]
	}
]);

describe('guideChapters', () => {
	test('a hunk the diff no longer has is dropped, and what the guide leaves out reads in a last chapter', () => {
		const chapters = guideChapters(
			guide([
				{ id: 'one', title: 'One', hunks: [{ id: ID.b, file: 'src/b.ts' }] },
				{ id: 'gone', title: 'Gone', hunks: [{ id: 'src/a.ts:9,1:9,1', file: 'src/a.ts' }] }
			]),
			FILES
		);

		expect(chapters.map((chapter) => [chapter.number, chapter.id, chapter.hunks.map((entry) => entry.id)])).toEqual([
			[1, 'one', [ID.b]],
			[2, 'rest', [ID.a1, ID.a2, 'src/new.ts:renamed-file']]
		]);
	});

	test('a hunk named twice reads only where it is named first', () => {
		const chapters = guideChapters(
			guide([{ id: 'one', title: 'One', hunks: [{ id: ID.b, file: 'src/b.ts' }] }, SPLIT.groups[1]]),
			[A, B]
		);

		expect(chapters[1].hunks.map((entry) => entry.id)).toEqual([ID.a1]);
	});

	test('a file split across chapters knows its place and where its other hunks read', () => {
		const chapters = guideChapters(SPLIT, [A, B]);

		const [second, first] = [chapters[0].hunks[0], chapters[1].hunks[1]];

		expect([second.index, second.place, first.index, first.place]).toEqual([
			1,
			{ at: 1, of: 2, elsewhere: [2] },
			0,
			{ at: 2, of: 2, elsewhere: [1] }
		]);

		expect(hunkWhere(second, A)).toBe('hunk 1 of 2 in this file · the other is in 02');
	});

	test('a file renamed with no line changed has one entry, with no hunk, that is never a move', () => {
		const chapters = guideChapters(
			guide([
				{
					id: 'one',
					title: 'One',
					hunks: [{ id: 'src/new.ts:renamed-file', file: 'src/new.ts', note: 'moved from src/old.ts' }]
				}
			]),
			[RENAMED]
		);

		expect(chapters[0].hunks[0]).toMatchObject({ index: null, line: null, moved: false });
	});
});

describe('hunkBugs', () => {
	test('each finding shows once: on the hunk that holds its line, else on the file’s first card', () => {
		const chapters = guideChapters(
			guide([
				{
					id: 'one',
					title: 'One',
					hunks: [
						{ id: ID.a2, file: 'src/a.ts' },
						{ id: ID.a1, file: 'src/a.ts' }
					]
				}
			]),
			[A]
		);

		const bugs = [
			{ id: 'on-first', line: 2, endLine: null },
			{ id: 'on-second', line: 40, endLine: 41 },
			{ id: 'nowhere', line: 99, endLine: null }
		];

		const [cardOfSecond, cardOfFirst] = chapters[0].hunks;

		expect(hunkBugs(bugs, A, cardOfSecond).map((bug) => bug.id)).toEqual(['on-second', 'nowhere']);
		expect(hunkBugs(bugs, A, cardOfFirst).map((bug) => bug.id)).toEqual(['on-first']);
	});
});
