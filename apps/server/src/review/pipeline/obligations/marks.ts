import type { Node } from 'web-tree-sitter';
import {
	argumentsOf,
	calleeName,
	calleePath,
	clip,
	exitsEarly,
	field,
	inForHeader,
	insideTryFinally,
	isLiteral,
	isNumber,
	lastName,
	lineOf,
	mayThrow,
	operatorOf,
	squash,
	statementOf,
	stringText,
	unwrap
} from './syntax.js';

/**
 * What one changed line does that a trigger may care about. `key` names the
 * operation across both sides (a parameter, operand pair, guard condition,
 * normalizer, error message or assertion subject); `value` is what can
 * change about it (a default, an operator, a matcher).
 */
export interface Mark {
	kind:
		| 'truthy'
		| 'default'
		| 'boundary'
		| 'compare'
		| 'count'
		| 'guard'
		| 'normalize'
		| 'acquire'
		| 'error'
		| 'exit'
		| 'assert'
		| 'skip';
	line: number;
	key: string;
	value: string;
	/** An assertion's strength: 2 pins a value, 1 only constrains it. */
	rank: number;
	/** The whole source line, clipped. */
	code: string;
	detail: string;
}

/** Names whose truthiness is the point: flags and predicates, and sizes checked against zero. */
const BOOLEAN_NAME =
	/^(is|has|should|can|did|was|will|allow|allows|enable|use|needs?)[A-Z_]|^(ok|done|enabled|disabled|aborted|active|visible|ready|valid|success|exists|loading|open|closed|checked|selected|required|async|debug|verbose|force|dryRun|length|size)$/;

const COUNT_NAME =
	/^(n|num|count|size|length|limit|total|qty|quantity|amount|pages?|offset|retries|attempts|workers|concurrency|depth|bytes|items|max\w*|min\w*)$|(Count|Size|Length|Limit|Total|Num|Retries|Attempts|Bytes|Items)$/;

const LIMIT_NAME = /max|min|limit|threshold|cap(acity)?$|bound|deadline|timeout|ttl|quota|budget|ceiling|floor/i;

/** `MAX_RETRIES`: a module constant, whose literal value is a default for everything that reads it. */
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]+$/;

const RELATIONAL = new Set(['<', '<=', '>', '>=']);

const ROUNDING = new Set([
	'Math.round',
	'Math.floor',
	'Math.ceil',
	'Math.trunc',
	'Math.min',
	'Math.max',
	'parseInt',
	'parseFloat',
	'Number.parseInt',
	'Number.parseFloat'
]);

const ROUNDING_METHODS = new Set(['toFixed', 'toPrecision']);

const INTEGER_CHECKS = new Set(['Number.isInteger', 'Number.isSafeInteger', 'Number.isFinite', 'Number.isNaN']);

/** Schema refinements that validate a number (`z.number().int().positive()`). */
const NUMBER_REFINEMENTS = new Set(['int', 'positive', 'nonnegative', 'negative', 'nonpositive', 'finite', 'safe']);

const NORMALIZERS = new Set([
	'trim',
	'trimStart',
	'trimEnd',
	'toLowerCase',
	'toUpperCase',
	'toLocaleLowerCase',
	'toLocaleUpperCase',
	'normalize',
	'replace',
	'replaceAll',
	'encodeURIComponent',
	'decodeURIComponent',
	'encodeURI',
	'decodeURI'
]);

const NORMALIZER_NAME = /^(normalize|canonical|slugify|sanitize)/i;

const ACQUIRE = new Set([
	'open',
	'openSync',
	'opendir',
	'opendirSync',
	'createReadStream',
	'createWriteStream',
	'connect',
	'createConnection',
	'getConnection',
	'acquire',
	'lock',
	'mkdtemp',
	'mkdtempSync',
	'spawn',
	'createServer',
	'listen',
	'watch',
	'setInterval',
	'beginTransaction',
	'startTransaction'
]);

const GUARD_CALL = /^(assert\w*|invariant|validate\w*|ensure\w*|require\w*|check\w*)$/;

/** Matchers that pass for more than one value, so swapping an exact one for them weakens the test. */
const LOOSE_MATCHERS = new Set([
	'toBeTruthy',
	'toBeFalsy',
	'toBeDefined',
	'toBeInstanceOf',
	'toHaveBeenCalled',
	'toBeGreaterThan',
	'toBeGreaterThanOrEqual',
	'toBeLessThan',
	'toBeLessThanOrEqual',
	'ok',
	'assert'
]);

const THROW_MATCHERS = new Set(['toThrow', 'toThrowError', 'throws', 'rejects']);

/**
 * Every mark on the given lines of a parsed file. Guards are read in source
 * files and assertions in test files, where an `assert` is the test itself.
 */
export function collectMarks(root: Node, lines: Set<number>, test: boolean): Mark[] {
	const sorted = [...lines].sort((a, b) => a - b);
	const source = root.text.split('\n');
	const marks: Mark[] = [];
	const stack: Node[] = [root];

	while (stack.length) {
		const node = stack.pop()!;

		if (!touches(node, sorted)) continue;
		if (lines.has(lineOf(node))) markNode(node, test, marks);

		for (let i = node.namedChildCount - 1; i >= 0; i--) {
			const child = node.namedChild(i);

			if (child) stack.push(child);
		}
	}

	return marks.map((entry) => ({ ...entry, code: clip(source[entry.line - 1] ?? '') })).sort((a, b) => a.line - b.line);
}

/** Whether any of the sorted lines falls inside the node. */
function touches(node: Node, sorted: number[]): boolean {
	const start = node.startPosition.row + 1;
	const end = node.endPosition.row + 1;
	let low = 0;
	let high = sorted.length;

	while (low < high) {
		const mid = (low + high) >> 1;

		if (sorted[mid] < start) low = mid + 1;
		else high = mid;
	}

	return low < sorted.length && sorted[low] <= end;
}

function mark(node: Node, kind: Mark['kind'], detail: string, extra: Partial<Mark> = {}): Mark {
	return { kind, line: lineOf(node), key: '', value: '', rank: 0, code: '', detail, ...extra };
}

function markNode(node: Node, test: boolean, marks: Mark[]): void {
	switch (node.type) {
		case 'parenthesized_expression':
			if (/^(if|while|do)_statement$/.test(node.parent?.type ?? '')) marks.push(...truthyMarks(unwrap(node)));
			break;
		case 'ternary_expression':
			marks.push(...truthyMarks(unwrap(field(node, 'condition') ?? node)));
			break;
		case 'binary_expression':
			marks.push(...binaryMarks(node));
			break;
		case 'call_expression':
			marks.push(...callMarks(node, test));
			break;
		case 'new_expression':
			marks.push(...errorMarks(node));
			break;
		case 'assignment_expression':
			if (squash(field(node, 'left')?.text ?? '') === 'process.exitCode') {
				marks.push(
					mark(node, 'exit', 'sets the exit status', {
						key: 'process.exitCode',
						value: squash(field(node, 'right')?.text ?? '')
					})
				);
			}

			break;
		case 'if_statement':
			if (!test && exitsEarly(field(node, 'consequence'))) marks.push(guardMark(node));
			break;
		default:
			marks.push(...defaultMarks(node));
	}
}

/** The bare values a condition tests for truthiness: `a` and `opts.b` in `!a || opts.b`, but not `a === 0` or `f(a)`. */
function truthyOperands(node: Node): Node[] {
	const inner = unwrap(node);

	if (inner.type === 'unary_expression' && operatorOf(inner) === '!') {
		return truthyOperands(field(inner, 'argument') ?? inner);
	}

	if (inner.type === 'binary_expression' && /^(&&|\|\|)$/.test(operatorOf(inner))) {
		return [inner.childForFieldName('left'), inner.childForFieldName('right')].flatMap((side) =>
			side ? truthyOperands(side) : []
		);
	}

	if (!/^(identifier|member_expression|subscript_expression)$/.test(inner.type)) return [];

	return BOOLEAN_NAME.test(lastName(inner) ?? '') ? [] : [inner];
}

function truthyMarks(condition: Node): Mark[] {
	return truthyOperands(condition).map((operand) =>
		mark(operand, 'truthy', `\`${clip(operand.text)}\` is tested for truthiness`, { key: squash(operand.text) })
	);
}

function binaryMarks(node: Node): Mark[] {
	const operator = operatorOf(node);
	const left = field(node, 'left');
	const right = field(node, 'right');

	if (!left || !right) return [];

	if (operator === '||' || operator === '??') return fallbackMarks(node, operator, left, right);

	if ((operator === '/' || operator === '%') && !(isNumber(left) && isNumber(right))) {
		return [mark(node, 'boundary', operator === '/' ? 'divides' : 'takes a remainder')];
	}

	return RELATIONAL.has(operator) ? comparisonMarks(node, operator, left, right) : [];
}

/** `x || 10` falls back on any falsy value; `x ?? 10` only on null or undefined. Both set a default for `x`. */
function fallbackMarks(node: Node, operator: string, left: Node, right: Node): Mark[] {
	if (!isLiteral(right) || !lastName(left)) return [];

	const key = squash(left.text);

	const fallback = mark(node, 'default', `\`${key}\` defaults to \`${clip(right.text)}\``, {
		key,
		value: squash(right.text)
	});

	if (operator === '??') return [fallback];

	return [fallback, mark(node, 'truthy', `\`${key}\` falls back to \`${clip(right.text)}\` when falsy`, { key })];
}

function comparisonMarks(node: Node, operator: string, left: Node, right: Node): Mark[] {
	if (inForHeader(node)) return [];

	const compare = mark(node, 'compare', `compares with \`${operator}\``, {
		key: `${squash(left.text)}~${squash(right.text)}`,
		value: operator
	});

	const numeric = isNumber(left) || isNumber(right);
	const names = [lastName(left), lastName(right)].filter((name): name is string => Boolean(name));

	if (numeric && names.some((name) => COUNT_NAME.test(name)) && validates(node)) {
		return [compare, mark(node, 'count', `validates \`${names[0]}\` against a number`, { key: names[0] })];
	}

	if (numeric || names.some((name) => LIMIT_NAME.test(name))) {
		return [compare, mark(node, 'boundary', `compares \`${clip(node.text)}\``)];
	}

	return [compare];
}

/** Whether a comparison decides an early exit or feeds an assertion: it validates input rather than computing. */
function validates(node: Node): boolean {
	let current = node;

	while (
		current.parent &&
		/^(binary_expression|parenthesized_expression|unary_expression)$/.test(current.parent.type)
	) {
		current = current.parent;
	}

	const parent = current.parent;

	if (parent?.type === 'if_statement') return exitsEarly(field(parent, 'consequence'));

	const call = parent?.type === 'arguments' ? parent.parent : null;

	return Boolean(call && GUARD_CALL.test(calleeName(call) ?? ''));
}

function callMarks(call: Node, test: boolean): Mark[] {
	const name = calleeName(call) ?? '';
	const path = calleePath(call);
	const marks: Mark[] = [];

	if (ROUNDING.has(path) || ROUNDING_METHODS.has(name))
		marks.push(mark(call, 'boundary', `rounds or bounds with \`${path}\``));

	if (INTEGER_CHECKS.has(path) || (NUMBER_REFINEMENTS.has(name) && path.includes('number('))) {
		marks.push(mark(call, 'count', `validates a number with \`${name}\``, { key: name }));
	}

	if (NORMALIZERS.has(name) || NORMALIZER_NAME.test(name)) {
		marks.push(mark(call, 'normalize', `normalizes with \`${name}\``, { key: name }));
	}

	if (ACQUIRE.has(name) && leaks(call))
		marks.push(mark(call, 'acquire', `acquires with \`${path}\` before code that can throw`, { key: name }));
	if (path === 'process.exit')
		marks.push(
			mark(call, 'exit', 'exits the process', {
				key: path,
				value: squash(
					argumentsOf(call)
						.map((arg) => arg.text)
						.join(',')
				)
			})
		);

	if (test) marks.push(...assertionMarks(call, name, path));
	else if (GUARD_CALL.test(name) && call.parent?.type === 'expression_statement') marks.push(guardMark(call));

	return marks;
}

/**
 * An acquisition whose release can be skipped: no `try … finally` around it
 * or right after it, the value isn't handed straight back, and a later
 * statement in the same block can throw.
 */
function leaks(call: Node): boolean {
	if (insideTryFinally(call)) return false;

	const statement = statementOf(call);

	if (!statement || statement.type === 'return_statement') return false;

	let throws = false;

	for (let next = statement.nextNamedSibling; next; next = next.nextNamedSibling) {
		if (next.type === 'try_statement' && field(next, 'finalizer')) return false;
		if (next.type !== 'comment' && mayThrow(next)) throws = true;
	}

	return throws;
}

function guardMark(node: Node): Mark {
	const condition = node.type === 'if_statement' ? unwrap(field(node, 'condition') ?? node) : node;

	return mark(node, 'guard', `guards with \`${clip(condition.text)}\``, { key: squash(condition.text) });
}

/** `new RangeError('count must be positive')`: the message is part of the contract callers and tests see. */
function errorMarks(node: Node): Mark[] {
	const constructor = lastName(field(node, 'constructor'));
	const message = stringText(argumentsOf(node)[0] ?? null);

	if (!constructor?.endsWith('Error') || message === null) return [];

	return [
		mark(node, 'error', `throws \`${constructor}\` with "${clip(message)}"`, {
			key: squash(message),
			value: constructor
		})
	];
}

/**
 * `expect(x).not.toBe(1)` and `assert.equal(x, 1)` keyed by subject, with the
 * matcher's strength; and `test.skip`, `it.todo`, `xit`, which turn a test off.
 */
function assertionMarks(call: Node, name: string, path: string): Mark[] {
	if (/^(test|it|describe)\.(skip|todo)$|^x(it|test|describe)$/.test(path)) {
		return [mark(call, 'skip', `turns a test off with \`${path}\``, { key: path })];
	}

	const expected = expectSubject(call);

	if (expected) {
		const rank =
			expected.negated || LOOSE_MATCHERS.has(name) || (THROW_MATCHERS.has(name) && !argumentsOf(call).length) ? 1 : 2;

		return [
			mark(call, 'assert', `asserts \`${clip(expected.subject)}\` with \`${name}\``, {
				key: squash(expected.subject),
				value: name,
				rank
			})
		];
	}

	if (path !== 'assert' && !path.startsWith('assert.')) return [];

	const subject = argumentsOf(call)[0]?.text ?? '';
	const rank = LOOSE_MATCHERS.has(name) || (THROW_MATCHERS.has(name) && argumentsOf(call).length < 2) ? 1 : 2;

	return [
		mark(call, 'assert', `asserts \`${clip(subject)}\` with \`${path}\``, { key: squash(subject), value: name, rank })
	];
}

/** The subject of `expect(subject)…matcher()`, and whether `.not` sits in the chain; null for any other call. */
function expectSubject(call: Node): { subject: string; negated: boolean } | null {
	let current = field(call, 'function');
	let negated = false;

	if (current?.type !== 'member_expression') return null;

	for (current = field(current, 'object'); current;) {
		if (current.type === 'member_expression') {
			negated ||= field(current, 'property')?.text === 'not';
			current = field(current, 'object');
		} else if (current.type === 'call_expression' && calleePath(current) === 'expect') {
			return { subject: argumentsOf(current)[0]?.text ?? '', negated };
		} else return null;
	}

	return null;
}

/** Parameter and destructuring defaults, and named constants whose literal value is the default. */
function defaultMarks(node: Node): Mark[] {
	const pair =
		node.type === 'required_parameter' || node.type === 'optional_parameter'
			? [field(node, 'pattern'), field(node, 'value')]
			: node.type === 'assignment_pattern' || node.type === 'object_assignment_pattern'
				? [field(node, 'left'), field(node, 'right')]
				: node.type === 'variable_declarator' && isLiteral(field(node, 'value'))
					? [field(node, 'name'), field(node, 'value')]
					: null;

	const [name, value] = pair ?? [];

	if (!name || !value) return [];

	if (node.type === 'variable_declarator' && !CONSTANT_NAME.test(name.text) && !/default|fallback/i.test(name.text)) {
		return [];
	}

	const key = squash(name.text);

	return [mark(node, 'default', `\`${key}\` defaults to \`${clip(value.text)}\``, { key, value: squash(value.text) })];
}
