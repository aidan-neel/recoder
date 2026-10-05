import type { AddedLines } from '../detectors/changed-lines.js';

/** A one-line change to source the PR added, for the test matrix to run the tests against. */
export interface Mutant {
	file: string;
	line: number;
	/** What the mutant does, in a few words, for the finding's text. */
	description: string;
	/** The whole file with the change applied. */
	text: string;
}

/** Mutants kept per review: a handful, since every one costs a test run. */
export const MAX_MUTANTS = 6;

/** A source file's line with one edit applied, or null when it has none to apply. */
type Edit = (line: string) => { line: string; description: string } | null;

const COMPARISONS: [RegExp, string][] = [
	[/ >= /, ' > '],
	[/ > /, ' >= '],
	[/ <= /, ' < '],
	[/ < /, ' <= '],
	[/ === /, ' !== '],
	[/ !== /, ' === ']
];

/** Normalizing calls whose removal changes what the code compares or returns. */
const NORMALIZERS = /\.(toLowerCase|toUpperCase|trim|trimEnd|trimStart)\(\)/;

/** The index after the parenthesis that closes the one opening at `open`, or -1. */
function closing(text: string, open: number): number {
	let depth = 0;

	for (let index = open; index < text.length; index++) {
		if (text[index] === '(') depth++;
		if (text[index] === ')' && --depth === 0) return index + 1;
	}

	return -1;
}

const flipComparison: Edit = (line) => {
	for (const [pattern, replacement] of COMPARISONS) {
		if (pattern.test(line))
			return { line: line.replace(pattern, replacement), description: `flip ${pattern.source.trim()}` };
	}

	return null;
};

const dropAwait: Edit = (line) =>
	/\bawait\s/.test(line) ? { line: line.replace(/\bawait\s+/, ''), description: 'drop an await' } : null;

const dropNormalizer: Edit = (line) => {
	const match = NORMALIZERS.exec(line);

	return match ? { line: line.replace(NORMALIZERS, ''), description: `remove .${match[1]}()` } : null;
};

/** The condition of a single-line `if (…)` forced to false, so the guarded branch never runs. */
const removeGuard: Edit = (line) => {
	const start = line.search(/\bif\s*\(/);

	if (start < 0) return null;

	const open = line.indexOf('(', start);
	const end = closing(line, open);

	if (end < 0) return null;

	return { line: `${line.slice(0, open)}(false)${line.slice(end)}`, description: 'force a guard to false' };
};

const nudgeLiteral: Edit = (line) => {
	const match = /(?<![\w.'"`$-])(\d+)(?![\w.'"`])/.exec(line);

	if (!match) return null;

	const next = Number(match[1]) + 1;

	return {
		line: `${line.slice(0, match.index)}${next}${line.slice(match.index + match[1]!.length)}`,
		description: `change ${match[1]} to ${next}`
	};
};

const EDITS: Edit[] = [removeGuard, flipComparison, dropNormalizer, dropAwait, nudgeLiteral];

/** Lines that hold no logic to change. */
const INERT = /^\s*(?:\/\/|\/\*|\*|import\b|export\s+(?:type|interface)\b)/;

/**
 * Up to `MAX_MUTANTS` single-line mutants of the lines a source file adds, at
 * most one per line and the kinds spread out so a handful covers the change.
 * Same input, same mutants.
 */
export function mutantsOf(file: string, head: string, added: AddedLines): Mutant[] {
	const lines = head.split('\n');
	const perKind = new Map<string, Mutant[]>();

	for (const [number] of added.get(file) ?? []) {
		const text = lines[number - 1];

		if (text === undefined || INERT.test(text)) continue;

		for (const edit of EDITS) {
			const made = edit(text);

			if (!made || made.line === text) continue;

			const copy = [...lines];

			copy[number - 1] = made.line;

			const mutants = perKind.get(edit.name) ?? [];

			mutants.push({ file, line: number, description: `${made.description} on line ${number}`, text: copy.join('\n') });
			perKind.set(edit.name, mutants);

			break;
		}
	}

	const queues = [...perKind.values()];
	const picked: Mutant[] = [];

	for (let round = 0; picked.length < MAX_MUTANTS && queues.some((queue) => queue.length > round); round++) {
		for (const queue of queues) if (queue[round] && picked.length < MAX_MUTANTS) picked.push(queue[round]!);
	}

	return picked;
}
