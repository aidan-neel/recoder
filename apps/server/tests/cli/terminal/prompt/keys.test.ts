import { expect, test } from 'bun:test';
import { parseKeys } from '../../../../src/cli/terminal/prompt/keys';

test('arrow keys, in both forms a terminal sends them, and Enter are read as keys', () => {
	expect(parseKeys('\u001b[A\u001bOB\r')).toEqual([{ name: 'up' }, { name: 'down' }, { name: 'enter' }]);
});

test('typed and pasted text arrives as one text key', () => {
	expect(parseKeys('opus 5')).toEqual([{ name: 'text', text: 'opus 5' }]);
});

test('several keys in one chunk are read in order', () => {
	expect(parseKeys('ab\u007f\u001b[B\r')).toEqual([
		{ name: 'text', text: 'ab' },
		{ name: 'backspace' },
		{ name: 'down' },
		{ name: 'enter' }
	]);
});

test('Ctrl-C arrives as a key, since raw mode sends no signal, and Escape alone leaves', () => {
	expect(parseKeys('\u0003')).toEqual([{ name: 'interrupt' }]);
	expect(parseKeys('\u001b')).toEqual([{ name: 'escape' }]);
});

test('a sequence the prompts have no use for is dropped whole, not read as Escape and text', () => {
	expect(parseKeys('\u001b[D\u001b[15~x')).toEqual([{ name: 'text', text: 'x' }]);
});
