import { expect, test } from 'bun:test';
import { truncate, visibleWidth, wrapText } from '../../../src/cli/terminal/text';

const RED = '\u001b[31m';

const DEFAULT_COLOR = '\u001b[39m';

const RESET = '\u001b[0m';

test('truncate cuts to the width, counting no columns for styles, and ends with the ellipsis', () => {
	const cut = truncate(`${RED}abcdefgh${DEFAULT_COLOR}`, 5, '…');

	expect(visibleWidth(cut)).toBe(5);
	expect(Bun.stripANSI(cut)).toBe('abcd…');
});

test('a cut inside a styled span closes the style, so what follows is not colored', () => {
	expect(truncate(`${RED}abcdefgh${DEFAULT_COLOR}`, 5, '…')).toBe(`${RED}abcd${RESET}…`);
});

test('text that fits is returned as it is', () => {
	expect(truncate(`${RED}abc${DEFAULT_COLOR}`, 3, '…')).toBe(`${RED}abc${DEFAULT_COLOR}`);
});

test('a wide character counts two columns when cutting', () => {
	expect(Bun.stripANSI(truncate('日本語のテキスト', 7, '…'))).toBe('日本語…');
});

test('wrapText breaks at spaces and keeps every line within the width', () => {
	const lines = wrapText('the quick brown fox jumps over the lazy dog', 12);

	expect(lines).toEqual(['the quick', 'brown fox', 'jumps over', 'the lazy dog']);
});

test('a word longer than a line is broken, and no part of it is lost', () => {
	const lines = wrapText('see apps/server/src/cli/terminal/text.ts now', 10);

	expect(lines.every((line) => visibleWidth(line) <= 10)).toBe(true);
	expect(lines.join('').replaceAll(' ', '')).toBe('seeapps/server/src/cli/terminal/text.tsnow');
});

test('a wrapped line keeps the indent of the line it came from, and a blank line stays', () => {
	expect(wrapText('    indented text that wraps\n\nnext', 16)).toEqual([
		'    indented',
		'    text that',
		'    wraps',
		'',
		'next'
	]);
});

test('a no-break space is not a place to break', () => {
	expect(wrapText('one two\u00a0three four', 9)).toEqual(['one', 'two\u00a0three', 'four']);
});
