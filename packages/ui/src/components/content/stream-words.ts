import type { ExtraProps } from 'react-markdown';

type HastElement = NonNullable<ExtraProps['node']>;

type HastChild = HastElement['children'][number];

type HastText = Extract<HastChild, { type: 'text' }>;

/** Inline elements that arrive as one piece: a code span, a link (a citation chip draws its own label). */
const UNITS = new Set(['code', 'a']);

/** A span marked with when its content went out, for the fade to pick up. */
function timed(at: number, children: HastChild[]): HastElement {
	return { type: 'element', tagName: 'span', properties: { dataT: Math.round(at) }, children };
}

/** A text node as its words, each in a timed span, with the space between them left as text. */
function splitText(node: HastText, arrivalAt: (offset: number) => number): HastChild[] {
	const start = node.position?.start.offset ?? Number.POSITIVE_INFINITY;

	return [...node.value.matchAll(/\s+|\S+/g)].map((part): HastChild => {
		const text: HastText = { type: 'text', value: part[0] };

		return /^\s/.test(part[0]) ? text : timed(arrivalAt(start + part.index), [text]);
	});
}

/** An element's children with each word and inline unit timed; fenced code is left whole. */
function timeChildren(element: { children: HastChild[] }, arrivalAt: (offset: number) => number): void {
	element.children = element.children.flatMap((child): HastChild[] => {
		if (child.type === 'text') return splitText(child, arrivalAt);
		if (child.type !== 'element' || child.tagName === 'pre') return [child];

		if (UNITS.has(child.tagName))
			return [timed(arrivalAt(child.position?.start.offset ?? Number.POSITIVE_INFINITY), [child])];

		if (child.tagName === 'li') child.properties.dataT = Math.round(arrivalAt(child.position?.start.offset ?? 0));

		timeChildren(child, arrivalAt);

		return [child];
	});
}

/**
 * A rehype plugin for text still streaming: each word, code span and link goes in a span that says when it went
 * out (`data-t`, from `arrivalAt` and the word's place in the source), and each list item says when it began, so
 * the words fade in as they arrive and a word drawn again (the parser regrouping a line) resumes its fade.
 */
export function streamWords(arrivalAt: (offset: number) => number) {
	return () => (tree: unknown) => timeChildren(tree as { children: HastChild[] }, arrivalAt);
}
