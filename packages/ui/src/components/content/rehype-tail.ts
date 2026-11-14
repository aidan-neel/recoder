/** The slice of a hast node the tail plugin reads. */
interface HastNode {
	type: string;
	tagName?: string;
	value?: string;
	properties?: Record<string, unknown>;
	children?: HastNode[];
}

/** Elements whose content stays verbatim or holds no text: the tail is never looked for inside them. */
const SEALED = new Set(['pre', 'code', 'table', 'hr', 'br', 'img', 'input']);

/** The last few words of a text, with the space after them: the words that arrived last. */
const LAST_WORDS = /\S+(?:\s+\S+){0,3}\s*$/;

/** An element, or text that is more than the whitespace between blocks. */
function hasContent(node: HastNode): boolean {
	if (node.type === 'element') return true;

	return (node.type === 'text' || node.type === 'raw') && Boolean(node.value?.trim());
}

/** The innermost element that ends the document, where the next streamed words will land. */
function lastContainer(root: HastNode): HastNode {
	let parent = root;

	for (;;) {
		const last = parent.children?.findLast(hasContent);

		if (!last || last.type !== 'element' || SEALED.has(last.tagName ?? '')) return parent;

		parent = last;
	}
}

/** The text split into what was there before and the last few words, the second wrapped in the shimmer's span. */
function splitTail(text: string): HastNode[] {
	const tail = LAST_WORDS.exec(text);

	if (!tail) return [{ type: 'text', value: text }];

	const before = text.slice(0, tail.index);

	const shimmer: HastNode = {
		type: 'element',
		tagName: 'span',
		properties: { dataUi: 'markdown-tail' },
		children: [{ type: 'text', value: tail[0] }]
	};

	return before ? [{ type: 'text', value: before }, shimmer] : [shimmer];
}

/**
 * A rehype plugin that wraps the last few words of a streaming document in a span, so they shimmer while the
 * text is still arriving. Text that ends in code or a table has no tail.
 */
export function rehypeStreamingTail() {
	return (tree: HastNode) => {
		const parent = lastContainer(tree);
		const children = parent.children ?? [];
		const index = children.findLastIndex(hasContent);
		const last = children[index];

		if (!last || last.type !== 'text' || !last.value) return;

		parent.children = [...children.slice(0, index), ...splitTail(last.value), ...children.slice(index + 1)];
	};
}
