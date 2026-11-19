import { describe, expect, test } from 'bun:test';
import type { DiffLine, FileDiff } from '@recoder/shared';

import { withoutWhitespace } from '../../src/lib/changes/whitespace';

const del = (oldNo: number, text: string): DiffLine => ({ type: 'del', oldNo, newNo: null, text });
const add = (newNo: number, text: string): DiffLine => ({ type: 'add', oldNo: null, newNo, text });
const ctx = (oldNo: number, newNo: number, text: string): DiffLine => ({ type: 'context', oldNo, newNo, text });

function file(lines: DiffLine[]): FileDiff {
	return {
		path: 'a.ts',
		additions: lines.filter((line) => line.type === 'add').length,
		deletions: lines.filter((line) => line.type === 'del').length,
		hunks: [{ header: '', oldStart: 1, oldCount: 0, newStart: 1, newCount: 0, lines }]
	};
}

describe('withoutWhitespace', () => {
	test('a re-indented line reads as one unchanged line with both numbers', () => {
		const out = withoutWhitespace(file([del(4, 'if (a) {'), add(4, '    if (a) {')]));

		expect(out.hunks[0].lines).toEqual([ctx(4, 4, '    if (a) {')]);
		expect([out.additions, out.deletions]).toEqual([0, 0]);
	});

	test('a real change between re-indented lines stays a change, in place', () => {
		const out = withoutWhitespace(
			file([del(1, 'a()'), del(2, 'b()'), del(3, 'c()'), add(1, '  a()'), add(2, '  x()'), add(3, '  c()')])
		);

		expect(out.hunks[0].lines).toEqual([ctx(1, 1, '  a()'), del(2, 'b()'), add(2, '  x()'), ctx(3, 3, '  c()')]);
		expect([out.additions, out.deletions]).toEqual([1, 1]);
	});

	test('lines that differ beyond whitespace are left alone', () => {
		const lines = [ctx(1, 1, 'x'), del(2, 'a + b'), add(2, 'a - b')];

		expect(withoutWhitespace(file(lines)).hunks[0].lines).toEqual(lines);
	});
});
