import { describe, expect, test } from 'bun:test';

import { fileLines } from '../../src/lib/files/file-lines';

describe('fileLines', () => {
	test('does not count the newline that ends the file as a line', () => {
		const lines = fileLines('a\nb\n', { path: 'x' });

		expect(lines.map((line) => line.text)).toEqual(['a', 'b']);
	});

	test('numbers lines from one and strips carriage returns', () => {
		const lines = fileLines('a\r\nb', { path: 'x' });

		expect(lines.map((line) => [line.newNo, line.text])).toEqual([
			[1, 'a'],
			[2, 'b']
		]);
	});

	test('flags the cited range, ends included', () => {
		const lines = fileLines('a\nb\nc\nd', { path: 'x', startLine: 2, endLine: 3 });

		expect(lines.map((line) => line.flagged)).toEqual([false, true, true, false]);
	});

	test('flags one line for a citation with a start and no end, and none without lines', () => {
		expect(fileLines('a\nb', { path: 'x', startLine: 2 }).map((line) => line.flagged)).toEqual([false, true]);
		expect(fileLines('a\nb', { path: 'x' }).some((line) => line.flagged)).toBe(false);
	});
});
