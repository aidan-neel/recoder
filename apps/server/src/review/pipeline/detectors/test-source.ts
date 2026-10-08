import { testStrengthOn } from '../test-strength.js';

/** An `expect` chain, an AVA `t.*` call or a Node `assert` call; `family` says which. */
export interface Assertion {
	family: 'expect' | 'ava' | 'assert';
	/** Source text with whitespace collapsed; two assertions with the same text are the same assertion. */
	text: string;
	modifiers: string[];
	method: string;
	args: string[];
	startLine: number;
	endLine: number;
}

/** One `test`/`it` call with a plain string title, named with the `describe` titles around it. */
export interface TestBlock {
	name: string;
	startLine: number;
	endLine: number;
	body: string;
	assertions: Assertion[];
}

const REGEX_PRECEDERS = '(,=:[!&|?{};';

const EXPECT_MODIFIERS = new Set(['not', 'resolves', 'rejects']);

function flat(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/** The index just past the string that opens at `start`; a quote left open ends at the line, or the file for a template. */
function quotedEnd(text: string, start: number): number {
	const quote = text[start];

	for (let i = start + 1; i < text.length; i++) {
		if (text[i] === '\\') i++;
		else if (text[i] === quote) return i + 1;
		else if (text[i] === '\n' && quote !== '`') return i;
	}

	return text.length;
}

/** The index just past the regex literal that opens at `start`, or -1 when the slash is a division. */
function regexEnd(text: string, start: number): number {
	let inClass = false;

	for (let i = start + 1; i < text.length; i++) {
		const char = text[i];

		if (char === '\n') return -1;
		if (char === '\\') i++;
		else if (char === '[') inClass = true;
		else if (char === ']') inClass = false;
		else if (char === '/' && !inClass) return i + 1;
	}

	return -1;
}

/**
 * The source with the inside of comments, strings and regex literals blanked
 * to spaces, so brackets and call names can be found without being fooled by
 * text. Offsets and newlines match the original. Template `${}` code is
 * treated as string text.
 */
function maskSource(text: string): string {
	const out = [...text];
	let last = '';
	let i = 0;

	const blank = (from: number, to: number) => {
		for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
	};

	while (i < text.length) {
		const char = text[i];
		const next = text[i + 1];

		if (char === '/' && next === '/') {
			const end = text.indexOf('\n', i);
			const stop = end < 0 ? text.length : end;

			blank(i, stop);
			i = stop;
		} else if (char === '/' && next === '*') {
			const close = text.indexOf('*/', i + 2);
			const stop = close < 0 ? text.length : close + 2;

			blank(i, stop);
			i = stop;
		} else if (char === '"' || char === "'" || char === '`') {
			const end = quotedEnd(text, i);

			blank(i + 1, text[end - 1] === char && end - 1 > i ? end - 1 : end);
			last = 'a';
			i = end;
		} else if (char === '/' && (last === '' || REGEX_PRECEDERS.includes(last)) && regexEnd(text, i) > 0) {
			const end = regexEnd(text, i);

			blank(i + 1, end - 1);
			last = 'a';
			i = end;
		} else {
			if (!/\s/.test(char)) last = char;

			i++;
		}
	}

	return out.join('');
}

/** The index of the bracket that closes the one at `open`, or -1. */
function matchClose(mask: string, open: number): number {
	let depth = 0;

	for (let i = open; i < mask.length; i++) {
		const char = mask[i];

		if (char === '(' || char === '[' || char === '{') depth++;
		else if ((char === ')' || char === ']' || char === '}') && --depth === 0) return i;
	}

	return -1;
}

/** The arguments of the call whose brackets sit at `open` and `close`, split at top-level commas. */
function splitArgs(mask: string, text: string, open: number, close: number): string[] {
	if (!mask.slice(open + 1, close).trim()) return [];

	const args: string[] = [];
	let depth = 0;
	let from = open + 1;

	for (let i = open + 1; i < close; i++) {
		const char = mask[i];

		if (char === '(' || char === '[' || char === '{') depth++;
		else if (char === ')' || char === ']' || char === '}') depth--;
		else if (char === ',' && depth === 0) {
			args.push(flat(text.slice(from, i)));
			from = i + 1;
		}
	}

	const tail = flat(text.slice(from, close));

	return tail ? [...args, tail] : args;
}

/** Start offsets of each line, so an offset maps to a 1-based line number by binary search. */
function lineLookup(text: string): (offset: number) => number {
	const starts = [0];

	for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);

	return (offset) => {
		let low = 0;
		let high = starts.length - 1;

		while (low < high) {
			const mid = Math.ceil((low + high) / 2);

			if (starts[mid] <= offset) low = mid;
			else high = mid - 1;
		}

		return low + 1;
	};
}

/** The modifiers and matcher call after `expect(...)` that closes at `close`; null when no matcher follows. */
function expectChain(mask: string, text: string, close: number) {
	const modifiers: string[] = [];
	let position = close + 1;

	for (;;) {
		const step = /^\s*\.\s*(\w+)(\s*\()?/.exec(mask.slice(position, position + 200));

		if (!step) return null;

		const [whole, name, paren] = step;

		if (!paren) {
			if (!EXPECT_MODIFIERS.has(name)) return null;

			modifiers.push(name);
			position += whole.length;

			continue;
		}

		const open = position + whole.length - 1;
		const end = matchClose(mask, open);

		return end < 0 ? null : { modifiers, method: name, args: splitArgs(mask, text, open, end), end: end + 1 };
	}
}

const AVA_METHODS = [
	'is',
	'not',
	'deepEqual',
	'notDeepEqual',
	'true',
	'false',
	'truthy',
	'falsy',
	'throws',
	'throwsAsync',
	'notThrows',
	'notThrowsAsync',
	'regex',
	'notRegex',
	'like'
];

/**
 * Matches the start of an assertion call. AVA's `t.assert` is read only when
 * the test-strength work is on, so the default review counts the assertions it
 * always has. Built per call because the flag is read from the environment.
 */
function assertionCall(): RegExp {
	const methods = testStrengthOn() ? [...AVA_METHODS, 'assert'] : AVA_METHODS;

	return new RegExp(`(?<![\\w.$])(?:expect|(t)\\.(${methods.join('|')})|(assert)(?:\\.(\\w+))?)\\s*\\(`, 'g');
}

/** Every assertion that starts inside `[from, to)`; an assertion nested in another one's arguments belongs to it. */
function assertionsIn(text: string, mask: string, from: number, to: number, lineOf: (at: number) => number) {
	const pattern = assertionCall();
	const found: Assertion[] = [];

	pattern.lastIndex = from;

	for (let match = pattern.exec(mask); match && match.index < to; match = pattern.exec(mask)) {
		const open = match.index + match[0].length - 1;
		const close = matchClose(mask, open);

		if (close < 0) continue;

		const args = splitArgs(mask, text, open, close);
		const family = match[1] ? 'ava' : match[3] ? 'assert' : 'expect';
		const chain = family === 'expect' ? expectChain(mask, text, close) : null;

		if (family === 'expect' && !chain) continue;

		const end = chain ? chain.end : close + 1;

		found.push({
			family,
			text: flat(text.slice(match.index, end)),
			modifiers: chain?.modifiers ?? [],
			method: chain?.method ?? match[2] ?? match[4] ?? '',
			args: chain ? [flat(text.slice(open + 1, close)), ...chain.args] : args,
			startLine: lineOf(match.index),
			endLine: lineOf(end - 1)
		});

		pattern.lastIndex = end;
	}

	return found;
}

/** The `test`/`it` calls in a file, keyed by qualified name; names that occur twice are left out as ambiguous. */
export function testBlocks(source: string): Map<string, TestBlock> {
	const mask = maskSource(source);
	const lineOf = lineLookup(source);
	const pattern = /(?<![\w.$])(describe|test|it)((?:\.\w+)*)\s*\(\s*(['"`])/g;
	const groups: { name: string; from: number; to: number }[] = [];
	const tests: (TestBlock & { from: number; to: number })[] = [];

	for (let match = pattern.exec(mask); match; match = pattern.exec(mask)) {
		const open = match.index + match[0].indexOf('(');
		const titleStart = match.index + match[0].length;
		const titleEnd = mask.indexOf(match[3], titleStart);
		const close = matchClose(mask, open);
		const name = source.slice(titleStart, titleEnd);

		if (titleEnd < 0 || close < 0 || match[2].includes('.each') || name.includes('${')) continue;

		if (match[1] === 'describe') {
			groups.push({ name, from: open, to: close });

			continue;
		}

		tests.push({
			name,
			from: open,
			to: close,
			startLine: lineOf(match.index),
			endLine: lineOf(close),
			body: source.slice(titleEnd + 1, close),
			assertions: assertionsIn(source, mask, titleEnd + 1, close, lineOf)
		});
	}

	const named = new Map<string, TestBlock[]>();

	for (const test of tests) {
		const parents = groups.filter((group) => group.from < test.from && test.to < group.to).map((group) => group.name);
		const key = [...parents, test.name].join(' > ');

		named.set(key, [...(named.get(key) ?? []), test]);
	}

	return new Map([...named].filter(([, blocks]) => blocks.length === 1).map(([key, blocks]) => [key, blocks[0]]));
}
