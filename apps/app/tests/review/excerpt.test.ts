import { describe, expect, test } from 'bun:test';
import type { DiffHunk, FileDiff } from '@recoder/shared';

import { excerpt, fileHunks, foldHunks } from '../../src/lib/review/excerpt';
import { addedHunk as hunk } from '../fixtures';

function diff(...hunks: DiffHunk[]): FileDiff {
	return { path: 'a.ts', additions: 0, deletions: 0, hunks };
}

describe('excerpt', () => {
	test('stays inside the hunk that holds the range, never running into the next one', () => {
		const code = excerpt(diff(hunk(10, 5), hunk(80, 10)), 13, 13, 'new');

		expect(code.lines.map((line) => line.newNo)).toEqual([10, 11, 12, 13, 14]);
		expect(code.lines.find((line) => line.flagged)?.newNo).toBe(13);
		expect(code.below).toBe(10);
	});
});

describe('fileHunks', () => {
	test('counts the unchanged lines before each hunk, including after a hunk that only deletes', () => {
		const deletion: DiffHunk = {
			header: '@@ -20,2 +19,0 @@',
			oldStart: 20,
			oldCount: 2,
			newStart: 19,
			newCount: 0,
			lines: [
				{ type: 'del', oldNo: 20, newNo: null, text: '' },
				{ type: 'del', oldNo: 21, newNo: null, text: '' }
			]
		};

		expect(fileHunks(diff(hunk(10, 5), deletion, hunk(40, 2)), []).map((part) => part.skipped)).toEqual([9, 5, 20]);
	});
});

describe('foldHunks', () => {
	test('keeps the top and the lines around an anchor, counting what each fold hides', () => {
		const hunks = fileHunks(diff(hunk(1, 100), hunk(300, 50)), []);
		const { runs, after } = foldHunks(hunks, (line) => line.newNo === 320, 10, 2);

		expect(runs.map((run) => [run.lines[0].newNo, run.lines.length, run.folded, run.skipped])).toEqual([
			[1, 10, 0, 0],
			[318, 5, 108, 0]
		]);

		expect(after).toBe(27);
	});

	test('keeps the unchanged-line count of a hunk that follows a kept run with nothing folded between', () => {
		const hunks = fileHunks(diff(hunk(1, 3), hunk(20, 3)), []);
		const { runs, after } = foldHunks(hunks, () => false, 6, 0);

		expect(runs.map((run) => [run.folded, run.skipped])).toEqual([
			[0, 0],
			[0, 16]
		]);

		expect(after).toBe(0);
	});
});
