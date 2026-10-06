import type { Node } from 'web-tree-sitter';

/** Declarations that start a new function body: protection and statements never reach past one. */
const FUNCTION_TYPES = new Set([
	'function_declaration',
	'function_expression',
	'function',
	'arrow_function',
	'method_definition',
	'generator_function',
	'generator_function_declaration'
]);

/** Statement lists, where a statement's later siblings run after it. */
const BLOCK_TYPES = new Set(['statement_block', 'program', 'switch_case', 'switch_default']);

const CODE_CHARS = 160;

/** The 1-based line a node starts on. */
export function lineOf(node: Node): number {
	return node.startPosition.row + 1;
}

/** Text with every run of whitespace removed, so reformatted code compares equal. */
export function squash(text: string): string {
	return text.replace(/\s+/g, '');
}

/** A node's first line, collapsed and clipped for a prompt or a report. */
export function clip(text: string): string {
	const line = text.split('\n')[0].replace(/\s+/g, ' ').trim();

	return line.length > CODE_CHARS ? `${line.slice(0, CODE_CHARS)}…` : line;
}

export function field(node: Node, name: string): Node | null {
	return node.childForFieldName(name);
}

/** A binary or unary expression's operator token. */
export function operatorOf(node: Node): string {
	return field(node, 'operator')?.text ?? '';
}

export function unwrap(node: Node): Node {
	let current = node;

	while (current.type === 'parenthesized_expression' && current.namedChildren[0]) current = current.namedChildren[0];

	return current;
}

export function isNumber(node: Node | null): boolean {
	if (!node) return false;
	if (node.type === 'number') return true;

	return node.type === 'unary_expression' && operatorOf(node) === '-' && field(node, 'argument')?.type === 'number';
}

const LITERAL_TYPES = new Set([
	'number',
	'string',
	'template_string',
	'true',
	'false',
	'null',
	'undefined',
	'array',
	'object'
]);

export function isLiteral(node: Node | null): boolean {
	return Boolean(node) && (LITERAL_TYPES.has(node!.type) || isNumber(node));
}

/** A string or template literal's text without its quotes, or null for anything else. */
export function stringText(node: Node | null): string | null {
	if (!node || (node.type !== 'string' && node.type !== 'template_string')) return null;

	return node.text.slice(1, -1);
}

/** The last name in an identifier or property chain: `limit` for `opts.limit`, null for anything else. */
export function lastName(node: Node | null): string | null {
	if (!node) return null;
	if (/identifier$/.test(node.type)) return node.text;
	if (node.type === 'member_expression') return field(node, 'property')?.text ?? null;

	return null;
}

/** What a call names: `round` for `Math.round(x)`, `parseInt` for `parseInt(x)`; null for a computed callee. */
export function calleeName(call: Node): string | null {
	return lastName(field(call, 'function'));
}

/** The callee as written, without whitespace: `Math.round`, `fs.openSync`. */
export function calleePath(call: Node): string {
	return squash(field(call, 'function')?.text ?? '');
}

/** A call's or `new` expression's arguments, skipping punctuation and comments. */
export function argumentsOf(call: Node): Node[] {
	return (field(call, 'arguments')?.namedChildren ?? []).filter(
		(child): child is Node => Boolean(child) && child!.type !== 'comment'
	);
}

/** Whether `node` sits in a `for (…; …; …)` header, where a comparison is the loop bound rather than a check. */
export function inForHeader(node: Node): boolean {
	for (let current: Node | null = node; current?.parent; current = current.parent) {
		const parent: Node = current.parent;

		if (FUNCTION_TYPES.has(parent.type) || BLOCK_TYPES.has(parent.type)) return false;
		if (parent.type === 'for_statement') return field(parent, 'body')?.id !== current.id;
	}

	return false;
}

/** A consequence that only leaves: `throw`, `return`, `continue` or `break`, bare or as the only statement in a block. */
export function exitsEarly(statement: Node | null): boolean {
	if (!statement) return false;

	const inner =
		statement.type === 'statement_block' && statement.namedChildren.length === 1
			? statement.namedChildren[0]
			: statement;

	return /^(throw|return|continue|break)_statement$/.test(inner?.type ?? '');
}

/** The statement holding `node` in its block, or null when a function boundary comes first. */
export function statementOf(node: Node): Node | null {
	for (let current: Node | null = node; current?.parent; current = current.parent) {
		if (BLOCK_TYPES.has(current.parent.type)) return current;
		if (FUNCTION_TYPES.has(current.parent.type)) return null;
	}

	return null;
}

/** Whether a `try` with a `finally` around `node`, inside the same function, already guards it. */
export function insideTryFinally(node: Node): boolean {
	for (let current: Node | null = node; current?.parent; current = current.parent) {
		const parent: Node = current.parent;

		if (FUNCTION_TYPES.has(parent.type)) return false;

		if (parent.type === 'try_statement' && field(parent, 'finalizer') && field(parent, 'body')?.id === current.id) {
			return true;
		}
	}

	return false;
}

/** Whether `node`, or anything inside it, can throw: a call, an `await`, a `new` or a `throw`. */
export function mayThrow(node: Node): boolean {
	return (
		/^(call_expression|await_expression|new_expression|throw_statement)$/.test(node.type) ||
		node.descendantsOfType(['call_expression', 'await_expression', 'new_expression', 'throw_statement']).length > 0
	);
}
