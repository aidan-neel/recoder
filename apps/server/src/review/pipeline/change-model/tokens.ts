import type { Node } from 'web-tree-sitter';
import { withTree } from './parser.js';

/** One leaf token with names and literal values normalized away. */
interface NormalizedToken {
	text: string;
	/** 1-based. */
	line: number;
}

/** Named nodes that are literal values; each becomes one `LIT` and is not descended into. */
const LITERAL =
	/(^|_)(string|template_string|number|integer|float|int|char|character|rune|decimal|symbol|heredoc)(_|$)|literal$/;

function isComment(type: string): boolean {
	return type.includes('comment');
}

function isIdentifier(type: string): boolean {
	return type.endsWith('identifier') || type === 'constant';
}

function collect(node: Node, out: NormalizedToken[]): void {
	if (isComment(node.type)) return;

	const line = node.startPosition.row + 1;

	if (node.isNamed && LITERAL.test(node.type)) {
		out.push({ text: 'LIT', line });

		return;
	}

	if (node.childCount === 0) {
		if (node.isNamed && isIdentifier(node.type)) out.push({ text: 'ID', line });
		else if (node.text.trim()) out.push({ text: node.text, line });

		return;
	}

	for (const child of node.children) if (child) collect(child, out);
}

/**
 * The file's leaf tokens in source order: identifiers become `ID`, string,
 * number and template literals become `LIT`, comments are dropped, and
 * keywords and punctuation keep their text. Two copies of the same code with
 * renamed variables give the same tokens. Null when no grammar covers the path.
 */
export async function normalizedTokens(path: string, source: string): Promise<NormalizedToken[] | null> {
	return withTree(path, source, (root) => {
		const out: NormalizedToken[] = [];

		collect(root, out);

		return out;
	});
}
