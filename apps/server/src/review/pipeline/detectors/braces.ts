import type { Node } from 'web-tree-sitter';
import { languageFor } from '../change-model/languages.js';
import { withTree } from '../change-model/parser.js';

/** The languages whose grammars share the JavaScript statement nodes this check reads; a Svelte file's scripts included. */
const BRACE_LANGUAGES = new Set(['typescript', 'tsx', 'javascript', 'svelte']);

/** Control-flow statements and the field that holds their body. */
const BODY_FIELDS: Record<string, string> = {
	if_statement: 'consequence',
	for_statement: 'body',
	for_in_statement: 'body',
	while_statement: 'body',
	do_statement: 'body'
};

/**
 * The statement an `else` runs. An `else if` is fine as it is: the nested
 * `if` is checked on its own.
 */
function elseBody(node: Node): Node | null {
	const statements = node.namedChildren.filter((child) => child?.type !== 'comment');

	return statements.at(-1) ?? null;
}

function bracedBody(node: Node): boolean {
	if (node.type === 'else_clause') {
		const body = elseBody(node);

		return !body || body.type === 'statement_block' || body.type === 'if_statement';
	}

	const body = node.childForFieldName(BODY_FIELDS[node.type]!);

	return !body || body.type === 'statement_block';
}

/** Whether a file's language has the control-flow statements this check reads. */
export function bracesApply(path: string): boolean {
	const language = languageFor(path);

	return language !== null && BRACE_LANGUAGES.has(language);
}

/**
 * The added lines in `source` where an `if`, `else`, `for`, `while` or `do`
 * starts whose body is not a `{ }` block, in line order. Arrow functions,
 * ternaries and object literals are expressions, so they never match.
 * Statements inside a parse error are skipped. Empty when the file can't be
 * parsed.
 */
export async function braceLessLines(path: string, source: string, added: Map<number, string>): Promise<number[]> {
	const lines = await withTree(path, source, (root) =>
		root
			.descendantsOfType([...Object.keys(BODY_FIELDS), 'else_clause'])
			.filter((node): node is Node => !!node && added.has(node.startPosition.row + 1))
			.filter((node) => !node.hasError && !bracedBody(node))
			.map((node) => node.startPosition.row + 1)
	);

	return [...new Set(lines ?? [])].sort((a, b) => a - b);
}
