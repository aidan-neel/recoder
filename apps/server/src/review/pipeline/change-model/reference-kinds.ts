import type { Node } from 'web-tree-sitter';
import { grammarSpec, type GrammarSpec } from './grammar-spec.js';
import { specifierOf } from './imports.js';
import { languageFor } from './languages.js';
import { withTree } from './parser.js';
import { isTestPath } from './test-files.js';
import type { ReferenceKind } from './types.js';

/** What the parser found in one file for the names asked about. */
export interface FileReferences {
	/** False where the parser does not see the whole file, so a line with no identifier may still be a use. */
	exact: boolean;
	/** `${name}\0${line}` → the strongest use on that line; a line missing here only names the word in a comment, string or declaration. */
	kinds: Map<string, ReferenceKind>;
	/** Modules the file imports, in source order. */
	specifiers: string[];
}

/** Strongest first, so a line that both calls and types a name counts as a call. */
const STRENGTH: ReferenceKind[] = ['call', 'type', 'import', 'other'];

/** Languages whose names also appear where the parser sees no identifier (Svelte markup, Ruby symbols). */
const INEXACT = new Set(['svelte', 'ruby']);

/** Nodes that qualify the name after them: `a.b`, `a::b`, `a->b`. */
const MEMBER_NODES = new Set([
	'member_expression',
	'attribute',
	'selector_expression',
	'field_expression',
	'scoped_identifier',
	'scoped_type_identifier',
	'qualified_identifier'
]);

const MEMBER_FIELDS = ['property', 'field', 'attribute', 'name'];

/** Nodes that import, or re-export from, another module; the name inside them is an import. */
const IMPORT_NODES = new Set([
	'import_statement',
	'import_from_statement',
	'import_declaration',
	'import_spec',
	'use_declaration',
	'import_require_clause'
]);

/** Parents that put a name in type position. */
const TYPE_PARENTS = new Set([
	'type',
	'type_annotation',
	'type_arguments',
	'type_query',
	'extends_clause',
	'implements_clause',
	'extends_type_clause'
]);

const JSX_ELEMENTS = new Set(['jsx_opening_element', 'jsx_self_closing_element']);

/** Interface members, which declare a name the way a method does. */
const SIGNATURE_NODES = new Set(['method_signature', 'property_signature']);

/** Parameter lists and parameters, whose names are local bindings. */
const PARAMETER_LISTS = new Set(['formal_parameters', 'parameters', 'lambda_parameters']);

const PARAMETERS = new Set([
	'required_parameter',
	'optional_parameter',
	'default_parameter',
	'typed_parameter',
	'typed_default_parameter'
]);

/** A line that is only a comment, by language family, for files the parser cannot read. */
const COMMENT_LINES: Record<string, RegExp> = { slash: /^(\/\/|\/\*|\*)/, hash: /^#/ };
const HASH_LANGUAGES = new Set(['python', 'ruby']);

const IMPORT_LINE = /^(import|from|use|using|require)\b/;

function isIdentifier(type: string): boolean {
	return type.endsWith('identifier') || type === 'constant';
}

function isSameNode(a: Node | null | undefined, b: Node): boolean {
	return Boolean(a) && a!.id === b.id;
}

/** Whether the name is a local binding or another symbol's own declaration, not a use of the changed one. */
function isBinding(node: Node, spec: GrammarSpec): boolean {
	const parent = node.parent;

	if (!parent) return false;

	if (spec.declarations[parent.type] || SIGNATURE_NODES.has(parent.type)) {
		return ['name', 'property', 'left'].some((field) => isSameNode(parent.childForFieldName(field), node));
	}

	if (PARAMETER_LISTS.has(parent.type)) return true;

	if (!PARAMETERS.has(parent.type)) return false;

	return isSameNode(
		parent.childForFieldName('pattern') ?? parent.childForFieldName('name') ?? parent.namedChild(0),
		node
	);
}

/** Whether the node sits in an import, a re-export `from`, or the pattern of a `require` declaration. */
function isImported(node: Node): boolean {
	let current = node;

	for (let parent = node.parent; parent; current = parent, parent = parent.parent) {
		if (IMPORT_NODES.has(parent.type)) return true;
		if (parent.type === 'export_statement' && parent.childForFieldName('source')) return true;
		if (parent.type !== 'variable_declarator' || !isSameNode(parent.childForFieldName('name'), current)) continue;

		const value = parent.childForFieldName('value');

		return value?.type === 'call_expression' && value.childForFieldName('function')?.text === 'require';
	}

	return false;
}

/** Whether the node names what a call, `new` or JSX element invokes, however qualified. */
function isCallee(node: Node, spec: GrammarSpec): boolean {
	let current = node;

	while (current.parent && MEMBER_NODES.has(current.parent.type)) {
		const member = current.parent;

		if (!MEMBER_FIELDS.some((field) => isSameNode(member.childForFieldName(field), current))) break;

		current = member;
	}

	const parent = current.parent;

	if (!parent) return false;
	if (JSX_ELEMENTS.has(parent.type)) return isSameNode(parent.childForFieldName('name'), current);

	const field = spec.calls[parent.type];

	return Boolean(field) && isSameNode(parent.childForFieldName(field), current);
}

function isTypeUse(node: Node): boolean {
	return node.type === 'type_identifier' || TYPE_PARENTS.has(node.parent?.type ?? '');
}

/** How one identifier uses its name, or null when it declares or shadows a different symbol. */
function useOf(node: Node, spec: GrammarSpec): ReferenceKind | null {
	if (isBinding(node, spec)) return null;
	if (isImported(node)) return 'import';
	if (isCallee(node, spec)) return 'call';

	return isTypeUse(node) ? 'type' : 'other';
}

function stronger(a: ReferenceKind | undefined, b: ReferenceKind): ReferenceKind {
	return a && STRENGTH.indexOf(a) <= STRENGTH.indexOf(b) ? a : b;
}

/** Walks the tree once: the use of every identifier that spells one of `names`, and every module imported. */
function collect(root: Node, source: string, names: Set<string>, spec: GrammarSpec): Omit<FileReferences, 'exact'> {
	const kinds: FileReferences['kinds'] = new Map();
	const specifiers: string[] = [];
	const stack: Node[] = [root];

	while (stack.length) {
		const node = stack.pop()!;
		const specifier = specifierOf(node);

		if (specifier !== null && !specifiers.includes(specifier)) specifiers.push(specifier);

		const text = isIdentifier(node.type) ? source.slice(node.startIndex, node.endIndex) : '';
		const use = names.has(text) ? useOf(node, spec) : null;
		const key = `${text}\0${node.startPosition.row + 1}`;

		if (use) kinds.set(key, stronger(kinds.get(key), use));

		const children = node.namedChildren;

		for (let i = children.length - 1; i >= 0; i--) if (children[i]) stack.push(children[i]!);
	}

	return { kinds, specifiers };
}

/**
 * How each of `names` is used on each line of a file, by the language's own
 * syntax. Null when no grammar covers the path. Words in comments and strings
 * produce nothing, so those lines are not references.
 */
export function fileReferences(file: string, source: string, names: Set<string>): Promise<FileReferences | null> {
	return withTree(file, source, (root, language) => {
		const spec = grammarSpec(language);

		return spec ? { exact: !INEXACT.has(language), ...collect(root, source, names, spec) } : null;
	});
}

/** A test-file use is a `test`; an import stays an import so callers can tell the two apart. */
export function inTestFile(file: string, kind: ReferenceKind): ReferenceKind {
	return kind !== 'import' && isTestPath(file) ? 'test' : kind;
}

/** The text as a regular expression that matches it literally. */
export function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The best guess at a use from its line alone, for files the parser did not
 * read: null for a line that is only a comment, else import, test, call or
 * other by the line's shape.
 */
export function lineKind(file: string, text: string, name: string): ReferenceKind | null {
	const language = languageFor(file);

	if (language) {
		const comment = COMMENT_LINES[HASH_LANGUAGES.has(language) ? 'hash' : 'slash'];

		if (comment.test(text)) return null;
	}

	if (IMPORT_LINE.test(text)) return 'import';

	const call = new RegExp(`(^|[^\\w$])${escapeRegExp(name)}\\s*\\(`).test(text);

	return inTestFile(file, call ? 'call' : 'other');
}
