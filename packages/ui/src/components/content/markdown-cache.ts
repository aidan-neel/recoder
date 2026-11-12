import type { ReactElement } from 'react';
import type { Components } from 'react-markdown';

/** Rendered sources kept per parts table: more than a review's findings, questions and replies together. */
const LIMIT = 64;

/**
 * The React tree each complete source rendered to, per parts table, the
 * least recently used first. A tree is a pure function of its source and
 * parts (the voice only styles the wrapper), and a React element can render
 * in any number of places, so one tree serves every mount of that text.
 */
const trees = new WeakMap<Components, Map<string, ReactElement>>();

/**
 * The tree `source` renders to with `parts`, rendered once by `render` and
 * then reused, so a remount (the reading pane remounts on every selection)
 * skips the Markdown parse. Only for complete text: streaming text changes on
 * every chunk and carries a caret.
 */
export function cachedMarkdown(parts: Components, source: string, render: () => ReactElement): ReactElement {
	let kept = trees.get(parts);

	if (!kept) {
		kept = new Map();
		trees.set(parts, kept);
	}

	const tree = kept.get(source) ?? render();

	kept.delete(source);
	kept.set(source, tree);

	if (kept.size > LIMIT) kept.delete(kept.keys().next().value as string);

	return tree;
}
