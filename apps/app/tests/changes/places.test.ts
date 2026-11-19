import { describe, expect, test } from 'bun:test';
import type { FileDiff } from '@recoder/shared';

import { hiddenBefore, placeHash, readPlace } from '../../src/lib/changes/places';

describe('readPlace', () => {
	test('reads a file, a file and line, and a finding', () => {
		expect(readPlace('#file=src%2Fa.ts')).toEqual({ kind: 'file', path: 'src/a.ts', line: null });
		expect(readPlace('#file=src/a.ts&line=42')).toEqual({ kind: 'file', path: 'src/a.ts', line: 42 });
		expect(readPlace('#finding=f1')).toEqual({ kind: 'finding', id: 'f1' });
	});

	test('a line that is not a positive whole number names no line', () => {
		for (const line of ['0', '-3', '4.5', 'x', '99999999']) {
			expect(readPlace(`#file=a.ts&line=${line}`)).toEqual({ kind: 'file', path: 'a.ts', line: null });
		}
	});

	test('a hash that names no place, such as the Review tab’s bug anchor, is nothing', () => {
		expect(readPlace('')).toBeNull();
		expect(readPlace('#bug-f1')).toBeNull();
	});

	test('reads back the hash it writes, for a path with spaces and an ampersand', () => {
		const place = { kind: 'file', path: 'docs/a & b.md', line: 3 } as const;

		expect(readPlace(placeHash(place))).toEqual(place);
	});
});

describe('hiddenBefore', () => {
	function hunk(newStart: number, newCount: number) {
		return { header: '', oldStart: newStart, oldCount: newCount, newStart, newCount, lines: [] };
	}

	test('counts the unchanged lines above the first hunk and between hunks', () => {
		const file: FileDiff = { path: 'a.ts', additions: 0, deletions: 0, hunks: [hunk(8, 9), hunk(30, 4), hunk(34, 2)] };

		expect(hiddenBefore(file)).toEqual([7, 13, 0]);
	});

	test('a deleted file hides nothing', () => {
		const file: FileDiff = { path: 'a.ts', additions: 0, deletions: 5, hunks: [hunk(0, 0)] };

		expect(hiddenBefore(file)).toEqual([0]);
	});
});
