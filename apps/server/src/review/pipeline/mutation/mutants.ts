import type { Node } from 'web-tree-sitter';
import type { AddedLines } from '../detectors/changed-lines.js';
import { withTree } from '../change-model/parser.js';

/** A one-line change to source the PR added, for the test matrix to run the tests against. */
export interface Mutant {
	file: string;
	line: number;
	/** Byte offset into the line where the change begins, for tree-sitter lookups on the unedited text. */
	column: number;
	/** What the mutant does, in a few words, for the finding's text. */
	description: string;
	/** The whole file with the change applied. */
	text: string;
}

/** Mutants kept per source file: a handful, since every one costs a test run. */
export const MAX_MUTANTS = 6;

/** A source file's line with one edit applied, or null when it has none to apply. `column` is the byte offset into the original line where the change begins. */
export type Edit = (line: string) => { line: string; column: number; description: string } | null;

/** The byte offset of `index` (a character offset) into `line`, the column unit tree-sitter reports. */
function byteColumn(line: string, index: number): number {
	return Buffer.byteLength(line.slice(0, index));
}

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
		const match = pattern.exec(line);

		if (match)
			return {
				line: line.replace(pattern, replacement),
				column: byteColumn(line, match.index + match[0].search(/\S/)),
				description: `flip ${pattern.source.trim()}`
			};
	}

	return null;
};

const dropAwait: Edit = (line) => {
	const match = /\bawait\s+/.exec(line);

	return match
		? { line: line.replace(/\bawait\s+/, ''), column: byteColumn(line, match.index), description: 'drop an await' }
		: null;
};

const dropNormalizer: Edit = (line) => {
	const match = NORMALIZERS.exec(line);

	return match
		? {
				line: line.replace(NORMALIZERS, ''),
				column: byteColumn(line, match.index),
				description: `remove .${match[1]}()`
			}
		: null;
};

/** The condition of a single-line `if (…)` forced to false, so the guarded branch never runs. */
const removeGuard: Edit = (line) => {
	const start = line.search(/\bif\s*\(/);

	if (start < 0) return null;

	const open = line.indexOf('(', start);
	const end = closing(line, open);

	if (end < 0) return null;

	return {
		line: `${line.slice(0, open)}(false)${line.slice(end)}`,
		column: byteColumn(line, open + 1),
		description: 'force a guard to false'
	};
};

const nudgeLiteral: Edit = (line) => {
	const match = /(?<![\w.'"`$-])(\d+)(?![\w.'"`])/.exec(line);

	if (!match) return null;

	const next = Number(match[1]) + 1;

	return {
		line: `${line.slice(0, match.index)}${next}${line.slice(match.index + match[1]!.length)}`,
		column: byteColumn(line, match.index),
		description: `change ${match[1]} to ${next}`
	};
};

/** A string literal with its last letter changed, so a message the test looks for is gone. */
const breakString: Edit = (line) => {
	const match = /(['"`])([^'"`\\\n]{4,}?)([a-z])\1/.exec(line);

	if (!match) return null;

	const text = `${match[1]}${match[2]}${match[3] === 'x' ? 'y' : 'x'}${match[1]}`;

	return {
		line: line.replace(match[0], text),
		column: byteColumn(line, match.index),
		description: 'change a message'
	};
};

/** A sort or comparison turned around, so the code picks the opposite item. */
const reverseOrder: Edit = (line) => {
	const sub = /\b(\w+(?:\.\w+)*) - (\w+(?:\.\w+)*)\b/.exec(line);

	if (sub)
		return {
			line: line.replace(sub[0], `${sub[2]} - ${sub[1]}`),
			column: byteColumn(line, sub.index),
			description: 'reverse a comparator'
		};

	return flipComparison(line);
};

const EDITS: Edit[] = [removeGuard, flipComparison, dropNormalizer, dropAwait, nudgeLiteral];

/** Lines that hold no logic to change. */
const INERT = /^\s*(?:\/\/|\/\*|\*|import\b|export\s+(?:type|interface)\b)/;

/** `new Specific(` on a throw line replaced by `new Broad(`, so the code throws the broad class the loose assertion accepts. */
export function swapErrorClass(broad: string): Edit {
	return (line) => {
		const match = /\bnew\s+([A-Z]\w*)\(/.exec(line);

		if (!match || match[1] === broad) return null;

		return {
			line: line.replace(match[0], `new ${broad}(`),
			column: byteColumn(line, match.index),
			description: `throw ${broad} instead of ${match[1]}`
		};
	};
}

/** A literal raised by one, the direction a lower-bound assertion cannot see. */
const raiseLiteral: Edit = nudgeLiteral;

/** The mutants one set of edits makes of the given lines, one per line, in line order. */
export function mutantsAt(file: string, head: string, lines: readonly number[], edits: readonly Edit[]): Mutant[] {
	const source = head.split('\n');
	const found: Mutant[] = [];

	for (const number of lines) {
		const text = source[number - 1];

		if (text === undefined || INERT.test(text)) continue;

		for (const edit of edits) {
			const made = edit(text);

			if (!made || made.line === text) continue;

			const copy = [...source];

			copy[number - 1] = made.line;

			found.push({
				file,
				line: number,
				column: made.column,
				description: `${made.description} on line ${number}`,
				text: copy.join('\n')
			});

			break;
		}
	}

	return found;
}

/** Nodes that end a walk up from an expression: the statements of a function or block body. */
const BODY_PARENTS = new Set(['statement_block', 'switch_case', 'switch_default']);

/**
 * Nodes whose contents run only when called or instantiated: a concise arrow
 * body, a function's parameters, a class field. A probe placed before their
 * top-level statement throws on import and proves nothing about the line.
 */
const DEFERRED_BODIES = new Set([
	'arrow_function',
	'function_declaration',
	'function_expression',
	'function_signature',
	'generator_function',
	'generator_function_declaration',
	'method_definition',
	'public_field_definition'
]);

/** Nodes that only exist for the type checker; no test can reach them. */
const TYPE_NODES = new Set([
	'interface_declaration',
	'type_alias_declaration',
	'type_annotation',
	'type_arguments',
	'ambient_declaration'
]);

/**
 * The mutant of a line with a `throw` put before its enclosing statement: a
 * test that reaches the statement fails with the marker. The walk starts at
 * the mutated token's column, so a condition inside an `else if` probes its
 * own branch, not the one before it. A line at module level probes the
 * statement that holds it, since the module evaluates on import; a line in a
 * type is not code at all, and one inside a deferred body (a concise arrow,
 * a function's parameters, a class field) has no module-level spot a probe
 * can reach, so it comes back `deferred`. Null when the file does not parse.
 */
export async function probeOf(
	file: string,
	head: string,
	mutant: { line: number; column: number }
): Promise<Mutant | 'type' | 'deferred' | null> {
	const rows = head.split('\n');

	const spot = await withTree(file, head, (root) => {
		let node: Node | null = root.descendantForPosition({ row: mutant.line - 1, column: mutant.column });
		let deferred = false;

		while (node && node.parent) {
			if (TYPE_NODES.has(node.type)) return 'type' as const;
			if (DEFERRED_BODIES.has(node.type)) deferred = true;
			if (BODY_PARENTS.has(node.parent.type)) return { row: node.startPosition.row, column: node.startPosition.column };

			if (node.parent.type === 'program') {
				if (deferred) return 'deferred' as const;

				return { row: node.startPosition.row, column: node.startPosition.column };
			}

			node = node.parent;
		}

		return null;
	});

	if (!spot || typeof spot === 'string') return spot;

	const target = rows[spot.row]!;

	rows[spot.row] = `${target.slice(0, spot.column)}throw new Error('recoder-probe'); ${target.slice(spot.column)}`;

	return {
		file,
		line: spot.row + 1,
		column: spot.column,
		description: `probe before line ${spot.row + 1}`,
		text: rows.join('\n')
	};
}

/**
 * Up to `MAX_MUTANTS` single-line mutants of the lines a source file adds, at
 * most one per line and the kinds spread out so a handful covers the change.
 * Same input, same mutants.
 */
export function mutantsOf(file: string, head: string, added: AddedLines): Mutant[] {
	const lines = [...(added.get(file)?.keys() ?? [])];
	const perKind = new Map<string, Mutant[]>();

	for (const edit of EDITS) perKind.set(edit.name, mutantsAt(file, head, lines, [edit]));

	const queues = [...perKind.values()];
	const picked: Mutant[] = [];

	for (let round = 0; picked.length < MAX_MUTANTS && queues.some((queue) => queue.length > round); round++) {
		for (const queue of queues) if (queue[round] && picked.length < MAX_MUTANTS) picked.push(queue[round]!);
	}

	return picked;
}

/** Edits by the shape of the weak assertion, in the order they are tried. */
export const EDITS_BY_SHAPE = {
	lowerBound: [raiseLiteral, removeGuard],
	someForEvery: [removeGuard, raiseLiteral],
	presence: [raiseLiteral, dropNormalizer, flipComparison],
	output: [breakString],
	selection: [reverseOrder],
	generic: EDITS
} as const;
