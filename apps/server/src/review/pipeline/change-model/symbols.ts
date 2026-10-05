import type { Node } from 'web-tree-sitter';
import { withTree } from './parser.js';
import { CONTROL, FUNCTION_VALUES, grammarSpec, RECEIVER_PARAMS, type GrammarSpec } from './grammar-spec.js';
import type { SymbolKind, SymbolMetrics, SymbolRange } from './types.js';

/** A declaration as the parser sees it, before the diff, references and examples are attached. */
export interface ParsedSymbol extends SymbolRange {
	language: string;
	signature: string;
	exported: boolean;
	calls: string[];
	metrics: SymbolMetrics;
}

/** The declarations around the one being walked, outermost first. */
interface Scope {
	names: string[];
	kind: SymbolKind | null;
	exported: boolean;
}

/** One file's walk: its grammar, what it exports by name, and what it found. */
interface Walk {
	file: string;
	language: string;
	source: string;
	spec: GrammarSpec;
	exportedNames: Set<string>;
	found: ParsedSymbol[];
}

/** Wrappers whose only declaration is the one inside, so the symbol's range starts at the wrapper. */
const SINGLE_WRAPPERS = new Set([
	'lexical_declaration',
	'variable_declaration',
	'type_declaration',
	'var_declaration',
	'const_declaration',
	'expression_statement'
]);

/** Wrappers that only export or decorate the declaration inside. */
const EXPORT_WRAPPERS = new Set(['export_statement', 'decorated_definition', 'ambient_declaration']);

const SIGNATURE_CHARS = 240;
const MAX_CALLS = 40;

/** Every declaration in a file, or null when no grammar covers its path. */
export function symbolsOf(file: string, source: string): Promise<ParsedSymbol[] | null> {
	return withTree(file, source, (root, language) => extractSymbols(root, language, file, source));
}

/** Every declaration in a parsed file, in source order, with nested members qualified by their container. */
function extractSymbols(root: Node, language: string, file: string, source: string): ParsedSymbol[] {
	const spec = grammarSpec(language);

	if (!spec) return [];

	const walk: Walk = { file, language, source, spec, exportedNames: exportClauseNames(root), found: [] };

	if (language === 'svelte') walk.found.push(svelteComponent(file, source));

	visitChildren(walk, root, { names: [], kind: null, exported: true });

	return walk.found;
}

function visitChildren(walk: Walk, node: Node, scope: Scope): void {
	for (const child of node.namedChildren) {
		if (!child) continue;

		const rule = walk.spec.declarations[child.type];

		if (rule) visitDeclaration(walk, child, scope);
		else if (walk.spec.transparent.has(child.type)) visitChildren(walk, child, scope);
	}
}

function visitDeclaration(walk: Walk, node: Node, scope: Scope): void {
	const rule = walk.spec.declarations[node.type];
	const name = nameOf(node);

	if (!name) return;

	const receiver = goReceiver(node);
	const owner: Scope = receiver ? { ...scope, names: [...scope.names, receiver], kind: 'class' } : scope;
	const outer = outerOf(node, walk.spec);
	const exported = isExported(walk, node, outer, name, owner);
	const kind = refineKind(node, rule.kind, owner, name, walk);
	const inner: Scope = { names: [...owner.names, name], kind, exported };

	if (!rule.hidden) walk.found.push(describe(walk, node, outer, { name, kind, exported, scope: owner }));
	if (rule.scope) visitChildren(walk, node.childForFieldName('body') ?? node, inner);
}

/** The symbol record for one declaration node. */
function describe(
	walk: Walk,
	node: Node,
	outer: Node,
	found: { name: string; kind: SymbolKind; exported: boolean; scope: Scope }
): ParsedSymbol {
	const fn = functionNode(node);
	const body = fn.childForFieldName('body');
	const startLine = outer.startPosition.row + 1;
	const endLine = outer.endPosition.row + 1;
	const isScope = Boolean(walk.spec.declarations[node.type]?.scope);

	return {
		name: found.name,
		qualifiedName: [...found.scope.names, found.name].join('.'),
		kind: found.kind,
		file: walk.file,
		startLine,
		endLine,
		language: walk.language,
		signature: signatureOf(walk.source, outer, body),
		exported: found.exported,
		calls: callsIn(fn, walk.spec, isScope),
		metrics: { lines: endLine - startLine + 1, maxDepth: depthOf(body ?? fn), params: paramsOf(fn, walk.language) }
	};
}

/** A Svelte file is a component spanning the whole file, so markup changes have an owner. */
function svelteComponent(file: string, source: string): ParsedSymbol {
	const base = file.slice(file.lastIndexOf('/') + 1).replace(/\.svelte$/, '');
	const lines = source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length;

	return {
		name: base,
		qualifiedName: base,
		kind: 'component',
		file,
		startLine: 1,
		endLine: Math.max(1, lines),
		language: 'svelte',
		signature: `<${base}>`,
		exported: true,
		calls: [],
		metrics: { lines: Math.max(1, lines), maxDepth: 0, params: 0 }
	};
}

/** Names a TS/JS file exports through `export { a, b as c }` or `export default a`. */
function exportClauseNames(root: Node): Set<string> {
	const names = new Set<string>();

	for (const statement of root.namedChildren) {
		if (statement?.type !== 'export_statement') continue;

		const value = statement.childForFieldName('value');

		if (value?.type === 'identifier') names.add(value.text);

		for (const clause of statement.namedChildren) {
			if (clause?.type !== 'export_clause') continue;

			for (const specifier of clause.namedChildren) {
				const local = specifier?.childForFieldName('name');

				if (local) names.add(local.text);
			}
		}
	}

	return names;
}

function nameOf(node: Node): string | null {
	const field = (name: string) => node.childForFieldName(name);

	switch (node.type) {
		case 'variable_declarator':
			return identifierText(field('name'));
		case 'field_definition':
			return field('property')?.text ?? null;
		case 'module':
			return field('name')?.text.replace(/^['"]|['"]$/g, '') ?? null;
		case 'assignment':
			return identifierText(field('left'));
		case 'impl_item':
			return field('type')?.text.replace(/<[\s\S]*$/, '') ?? null;
		case 'field_declaration':
			return field('declarator')?.childForFieldName('name')?.text ?? null;
		default:
			return field('name')?.text ?? null;
	}
}

/** A plain identifier's text; destructuring patterns and member targets have no single name. */
function identifierText(node: Node | null): string | null {
	if (!node) return null;

	return node.type === 'identifier' || node.type === 'constant' ? node.text : null;
}

/** The receiver type that qualifies a Go method, with pointer and type parameters dropped. */
function goReceiver(node: Node): string | null {
	if (node.type !== 'method_declaration') return null;

	const receiver = node
		.childForFieldName('receiver')
		?.namedChildren.find((child) => child?.type === 'parameter_declaration');

	return (
		receiver
			?.childForFieldName('type')
			?.text.replace(/^\*/, '')
			.replace(/\[[\s\S]*$/, '') || null
	);
}

/** The node a symbol's range and signature start from: its export, decorator or single-declaration wrapper. */
function outerOf(node: Node, spec: GrammarSpec): Node {
	let outer = node;
	const parent = node.parent;

	if (parent && SINGLE_WRAPPERS.has(parent.type)) {
		const declarations = parent.namedChildren.filter((child) => child && spec.declarations[child.type]);

		if (declarations.length === 1) outer = parent;
	}

	while (outer.parent && EXPORT_WRAPPERS.has(outer.parent.type)) outer = outer.parent;

	return outer;
}

function isExported(walk: Walk, node: Node, outer: Node, name: string, scope: Scope): boolean {
	switch (walk.language) {
		case 'go':
			return /^[A-Z]/.test(name.slice(name.lastIndexOf('.') + 1));
		case 'rust':
			return scope.kind === 'interface'
				? scope.exported
				: node.namedChildren.some((child) => child?.type === 'visibility_modifier' && child.text.startsWith('pub'));
		case 'java':
			return scope.kind === 'interface' || /\bpublic\b/.test(modifiersText(node));
		case 'python':
		case 'ruby':
			return scope.exported && !name.startsWith('_');
		default:
			return jsExported(walk, node, outer, name, scope);
	}
}

function modifiersText(node: Node): string {
	return node.namedChildren.find((child) => child?.type === 'modifiers')?.text ?? '';
}

/** Top level: an `export` keyword or a later export clause. Members: the container is exported and the member isn't private. */
function jsExported(walk: Walk, node: Node, outer: Node, name: string, scope: Scope): boolean {
	if (scope.names.length === 0) return outer.type === 'export_statement' || walk.exportedNames.has(name);

	if (scope.kind === 'module') return scope.exported && outer.type === 'export_statement';

	const isPrivate =
		name.startsWith('#') ||
		node.namedChildren.some((child) => child?.type === 'accessibility_modifier' && child.text !== 'public');

	return scope.exported && !isPrivate;
}

function refineKind(node: Node, kind: SymbolKind, scope: Scope, name: string, walk: Walk): SymbolKind {
	const inClass = scope.kind === 'class' || scope.kind === 'interface';

	if (node.type === 'type_spec') {
		const type = node.childForFieldName('type')?.type;

		return type === 'struct_type' ? 'class' : type === 'interface_type' ? 'interface' : 'type';
	}

	const isFunction = kind === 'function' || (kind === 'variable' && functionNode(node) !== node);

	if (!isFunction) return kind;
	if (inClass) return 'method';
	if (isComponentFile(walk) && /^[A-Z]/.test(name)) return 'component';

	return 'function';
}

/** TSX, and JSX in a `.jsx` file, where a capitalized function is a component. */
function isComponentFile(walk: Walk): boolean {
	return walk.language === 'tsx' || (walk.language === 'javascript' && walk.file.endsWith('.jsx'));
}

/** The function a declaration holds: an arrow or function value of a variable or field, else the node itself. */
function functionNode(node: Node): Node {
	const value = node.childForFieldName('value') ?? node.childForFieldName('right');

	return value && FUNCTION_VALUES.has(value.type) ? value : node;
}

/** From the declaration's first line to where its body starts, whitespace collapsed and clipped. */
function signatureOf(source: string, outer: Node, body: Node | null): string {
	const end = body && body.startIndex > outer.startIndex ? body.startIndex : outer.endIndex;
	let text = source.slice(outer.startIndex, end);

	if (!body) text = text.split('\n')[0];

	const collapsed = text.replace(/\s+/g, ' ').trim();

	return collapsed.length > SIGNATURE_CHARS ? `${collapsed.slice(0, SIGNATURE_CHARS)}…` : collapsed;
}

/** Names called in the body, in source order; a container skips its members, which are symbols of their own. */
function callsIn(node: Node, spec: GrammarSpec, isScope: boolean): string[] {
	const calls = new Set<string>();
	const stack: Node[] = [node];

	while (stack.length && calls.size < MAX_CALLS) {
		const current = stack.pop()!;

		if (current !== node && isScope && spec.declarations[current.type]) continue;

		const field = spec.calls[current.type];

		if (field) {
			const callee = calleeName(current.childForFieldName(field));

			if (callee) calls.add(callee);
		}

		const children = current.namedChildren;

		for (let i = children.length - 1; i >= 0; i--) {
			const child = children[i];

			if (child) stack.push(child);
		}
	}

	return [...calls];
}

/** The last segment of what a call names: `bar` for `foo.bar()`, `Thing` for `new ns.Thing()`. */
function calleeName(node: Node | null): string | null {
	let current = node;

	for (let hops = 0; current && hops < 8; hops++) {
		if (/identifier$|^constant$/.test(current.type)) return current.text;

		current =
			current.childForFieldName('property') ??
			current.childForFieldName('field') ??
			current.childForFieldName('attribute') ??
			current.childForFieldName('name') ??
			current.childForFieldName('method') ??
			(current.type === 'generic_type' || current.type === 'scoped_type_identifier'
				? current.namedChildren.at(-1)
				: null) ??
			null;
	}

	return null;
}

/** The deepest nesting of control flow and closures inside `node`; an else-if continues its chain. */
function depthOf(node: Node): number {
	let deepest = 0;

	for (const child of node.namedChildren) {
		if (!child) continue;

		const nests = CONTROL.has(child.type) && !isElseIf(child) ? 1 : 0;

		deepest = Math.max(deepest, nests + depthOf(child));
	}

	return deepest;
}

function isElseIf(node: Node): boolean {
	const parent = node.parent;

	if (!parent) return false;

	return parent.type === 'else_clause' || parent.childForFieldName('alternative')?.id === node.id;
}

/** Declared parameters, without receivers (`self`, `this`); a Go `a, b int` counts two. */
function paramsOf(fn: Node, language: string): number {
	const list = fn.childForFieldName('parameters') ?? fn.childForFieldName('parameter');

	if (!list) return 0;
	if (list.type === 'identifier') return 1;

	let count = 0;

	for (const [index, param] of list.namedChildren.entries()) {
		if (!param || RECEIVER_PARAMS.has(param.type)) continue;
		if (language === 'python' && index === 0 && (param.text === 'self' || param.text === 'cls')) continue;

		const names = param.type === 'parameter_declaration' ? param.childrenForFieldName('name').length : 0;

		count += Math.max(1, names);
	}

	return count;
}
