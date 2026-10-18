/** The slice of a hast node the caret plugin reads. */
interface HastNode {
	type: string;
	tagName?: string;
	value?: string;
	properties?: Record<string, unknown>;
	children?: HastNode[];
}

/** Elements whose content stays verbatim or holds no text: the caret goes after them, not inside. */
const SEALED = new Set(['pre', 'code', 'table', 'hr', 'br', 'img', 'input']);

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

/** A rehype plugin that puts the streaming caret right after the last text of the document. */
export function rehypeCaret() {
	return (tree: HastNode) => {
		const parent = lastContainer(tree);

		parent.children = [
			...(parent.children ?? []),
			{ type: 'element', tagName: 'span', properties: { dataUi: 'markdown-caret', ariaHidden: 'true' }, children: [] }
		];
	};
}
