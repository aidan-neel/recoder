import { FORGE_PATHS, LINK_GLYPH_PATHS } from '../display/forge-paths';
import type { TextRange } from './link-find';
import type { LinkDescription, LinkFact } from './link-describe';
import type { TextSelection } from './link-edits';
import { segmentsOf, type LinkDoc, type Segment } from './link-model';

/** How the field draws one link: what its URL says, and what the host knows about it. */
export interface EmbedLook {
	description: LinkDescription;
	fact: LinkFact | undefined;
}

const SVG = 'http://www.w3.org/2000/svg';

/** The attribute an embed carries its URL in. */
const URL_ATTRIBUTE = 'data-url';

/** A zero-width space: the one character of a caret holder, never part of the text. */
const HOLDER_CHARACTER = '\u200B';

/**
 * Caret holders: text nodes the field adds before an embed that starts the
 * field or follows another embed, and after an embed that ends it. Browsers
 * cannot put a caret beside a non-editable element with no text next to it:
 * Chrome moves it after the embed, Firefox before. A holder counts as no text.
 */
const holders = new WeakSet<Text>();

/** One child the field draws: a run of the content, or a caret holder before an embed. */
type Part = Segment | { kind: 'holder' };

/**
 * Makes the field's children match the content: text nodes for text, one
 * embed element for each link, and a closing `<br>` when the text ends in a
 * line break so the empty last line shows. Nodes that already match are
 * kept, so the caret and the browser's spelling marks stay put.
 */
export function renderDoc(root: HTMLElement, doc: LinkDoc, look: (url: string) => EmbedLook): void {
	const parts = partsOf(segmentsOf(doc));

	parts.forEach((part, index) => placePart(root, index, part, look));

	while (root.childNodes.length > parts.length) root.lastChild?.remove();

	if (doc.text.endsWith('\n')) root.append(document.createElement('br'));
}

/** The embed element a node belongs to, if it sits in one. */
export function embedOf(node: Node | null): HTMLElement | null {
	const element = node instanceof Element ? node : (node?.parentElement ?? null);

	return element?.closest<HTMLElement>('[data-ui="link-embed"]') ?? null;
}

/** The selection as text offsets, or null when it is not in the field. */
export function readSelection(root: HTMLElement): TextSelection | null {
	const selection = root.ownerDocument.getSelection();

	if (!selection?.anchorNode || !selection.focusNode) return null;
	if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;

	return {
		anchor: offsetOf(root, selection.anchorNode, selection.anchorOffset),
		focus: offsetOf(root, selection.focusNode, selection.focusOffset)
	};
}

/** Puts the selection at text offsets: a caret when both are equal. */
export function writeSelection(root: HTMLElement, { anchor, focus }: TextSelection): void {
	const selection = root.ownerDocument.getSelection();

	if (!selection) return;

	const from = pointOf(root, anchor);
	const to = pointOf(root, focus);

	selection.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
}

/** A DOM range as text offsets: what `getTargetRanges()` says an edit would change. */
export function rangeOffsets(root: HTMLElement, range: StaticRange): TextRange {
	const start = offsetOf(root, range.startContainer, range.startOffset);
	const end = offsetOf(root, range.endContainer, range.endOffset);

	return { start: Math.min(start, end), end: Math.max(start, end) };
}

/**
 * Reads the content back from the DOM, for the edits the field cannot make
 * itself (an IME composition writes straight into the text nodes). Embeds
 * stay embeds; any other element counts as its text.
 */
export function readDoc(root: HTMLElement): LinkDoc {
	let text = '';
	const links: TextRange[] = [];

	for (const child of root.childNodes) {
		const url = urlOf(child);

		if (url !== null) links.push({ start: text.length, end: text.length + url.length });

		text += url ?? lengthText(child);
	}

	return { text, links };
}

/** The embed element that shows the link at `range`, if the field shows one there. */
export function embedAt(root: HTMLElement, range: TextRange): HTMLElement | null {
	let at = 0;

	for (const child of root.childNodes) {
		if (at === range.start && child instanceof HTMLElement && urlOf(child) !== null) return child;

		at += nodeLength(child);
	}

	return null;
}

/** Marks the embeds a selection holds whole, so a selected embed looks selected. */
export function markSelected(root: HTMLElement, range: TextRange | null): void {
	let at = 0;

	for (const child of root.childNodes) {
		const length = nodeLength(child);

		if (child instanceof HTMLElement && urlOf(child) !== null) {
			const held = range !== null && range.start < range.end && range.start <= at && at + length <= range.end;

			child.toggleAttribute('data-selected', held);
		}

		at += length;
	}
}

/** The two ways a browser finds the DOM point under the pointer: the standard one, and the one older WebKit has. */
interface CaretLookup {
	caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
	caretRangeFromPoint?: (x: number, y: number) => Range | null;
}

/** The DOM point under a point on screen, by whichever lookup the browser has. */
function pointAt(page: CaretLookup, x: number, y: number): { node: Node; offset: number } | null {
	const position = page.caretPositionFromPoint?.(x, y);

	if (position) return { node: position.offsetNode, offset: position.offset };

	const range = page.caretRangeFromPoint?.(x, y);

	return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/** The text range an embed element shows, read from the DOM. */
export function embedRange(root: HTMLElement, embed: HTMLElement): TextRange | null {
	let at = 0;

	for (const child of root.childNodes) {
		const length = nodeLength(child);

		if (child === embed) return { start: at, end: at + length };

		at += length;
	}

	return null;
}

/** The text offset under a point on screen, for a drop: a point on an embed counts as its end. Null outside the field. */
export function offsetAtPoint(root: HTMLElement, x: number, y: number): number | null {
	const point = pointAt(root.ownerDocument, x, y);

	if (!point || !root.contains(point.node)) return null;

	const embed = embedOf(point.node);

	if (embed) return embedRange(root, embed)?.end ?? null;

	return offsetOf(root, point.node, point.offset);
}

/** Room kept between the caret and the field's edge when the field scrolls to show it. */
const CARET_MARGIN = 4;

/** Scrolls the field so the caret shows, after an edit the browser did not make itself. */
export function scrollToCaret(root: HTMLElement): void {
	const rect = caretRect(root);

	if (!rect) return;

	const box = root.getBoundingClientRect();

	if (rect.bottom > box.bottom - CARET_MARGIN) root.scrollTop += rect.bottom - box.bottom + CARET_MARGIN;
	else if (rect.top < box.top + CARET_MARGIN) root.scrollTop -= box.top + CARET_MARGIN - rect.top;
}

/** Where the caret is on screen; null when the browser cannot say. */
function caretRect(root: HTMLElement): DOMRect | null {
	const selection = root.ownerDocument.getSelection();

	if (!selection || selection.rangeCount === 0) return null;

	const rects = selection.getRangeAt(0).getClientRects();

	return rects.length > 0 ? rects[rects.length - 1] : null;
}

/** The children to draw: the segments, with a caret holder on each side of an embed that has no text there. */
function partsOf(segments: Segment[]): Part[] {
	const parts = segments.flatMap((segment, index): Part[] => {
		const holds = segment.kind === 'link' && (index === 0 || segments[index - 1].kind === 'link');

		return holds ? [{ kind: 'holder' }, segment] : [segment];
	});

	return segments.at(-1)?.kind === 'link' ? [...parts, { kind: 'holder' }] : parts;
}

/** Keeps the child at `index` matching one part, reusing the node there when it can. */
function placePart(root: HTMLElement, index: number, part: Part, look: (url: string) => EmbedLook): void {
	const current = root.childNodes[index] ?? null;

	if (part.kind === 'holder') {
		placeHolder(root, current);

		return;
	}

	if (part.kind === 'text') {
		placeText(root, current, part.text);

		return;
	}

	placeEmbed(root, current, part.url, look);
}

/** A caret holder at `current`'s place: the one there, reset, or a new one. */
function placeHolder(root: HTMLElement, current: ChildNode | null): void {
	if (current instanceof Text && holders.has(current)) {
		if (current.data !== HOLDER_CHARACTER) current.data = HOLDER_CHARACTER;

		return;
	}

	const holder = document.createTextNode(HOLDER_CHARACTER);

	holders.add(holder);
	root.insertBefore(holder, current);
}

/** A text run at `current`'s place: the text node there, rewritten, or a new one. */
function placeText(root: HTMLElement, current: ChildNode | null, text: string): void {
	if (current instanceof Text) {
		holders.delete(current);

		if (current.data !== text) current.data = text;

		return;
	}

	root.insertBefore(document.createTextNode(text), current);
}

/** An embed at `current`'s place: the one there when it shows the same link the same way, else a new one. */
function placeEmbed(root: HTMLElement, current: ChildNode | null, url: string, look: (url: string) => EmbedLook): void {
	const wanted = look(url);
	const key = lookKey(wanted);

	if (current instanceof HTMLElement && urlOf(current) === url && current.dataset.look === key) return;

	const embed = buildEmbed(wanted, key);

	if (current && urlOf(current) !== null) current.replaceWith(embed);
	else root.insertBefore(embed, current);
}

/** What makes two looks of one URL draw the same. */
function lookKey({ description, fact }: EmbedLook): string {
	return [description.label, fact?.tone ?? '', fact?.status ?? '', fact?.title ?? ''].join('\u0000');
}

/**
 * One embed: a non-editable inline element that carries its URL, read out as
 * a link with a readable name. Every string goes in through `textContent` or
 * an attribute, never as markup.
 */
function buildEmbed({ description, fact }: EmbedLook, key: string): HTMLElement {
	const embed = document.createElement('span');
	const label = document.createElement('span');

	embed.contentEditable = 'false';
	embed.dataset.ui = 'link-embed';
	embed.dataset.kind = description.kind;
	embed.dataset.look = key;
	embed.setAttribute(URL_ATTRIBUTE, description.url);
	embed.setAttribute('role', 'link');
	embed.setAttribute('aria-label', fact?.status ? `${description.name}, ${fact.status}` : description.name);
	label.dataset.ui = 'link-embed-label';
	label.textContent = description.label;
	embed.append(buildMark(description), label);

	if (fact?.tone) embed.append(buildDot(fact.tone));

	return embed;
}

/** The forge's mark, or the link glyph for any other site, drawn at the label's size. */
function buildMark(description: LinkDescription): SVGSVGElement {
	const svg = document.createElementNS(SVG, 'svg');
	const paths = description.forge ? [FORGE_PATHS[description.forge]] : LINK_GLYPH_PATHS;

	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('aria-hidden', 'true');
	svg.dataset.ui = 'link-embed-mark';
	svg.dataset.glyph = description.forge ?? 'link';

	for (const d of paths) {
		const path = document.createElementNS(SVG, 'path');

		path.setAttribute('d', d);
		svg.append(path);
	}

	return svg;
}

/** The fact's dot, in its tone. */
function buildDot(tone: string): HTMLElement {
	const dot = document.createElement('span');

	dot.dataset.ui = 'link-embed-dot';
	dot.dataset.tone = tone;

	return dot;
}

/** The URL an embed node carries, or null for any other node. */
function urlOf(node: Node): string | null {
	return node instanceof HTMLElement && node.dataset.ui === 'link-embed' ? node.getAttribute(URL_ATTRIBUTE) : null;
}

/** The text a non-embed child stands for: a text node's data (a holder's without its own character), nothing for the closing `<br>`. */
function lengthText(node: Node): string {
	if (node instanceof Text) return holders.has(node) ? node.data.replaceAll(HOLDER_CHARACTER, '') : node.data;
	if (node instanceof HTMLBRElement) return '';

	return node.textContent ?? '';
}

/** How many text characters a child of the field stands for. */
function nodeLength(node: Node): number {
	return (urlOf(node) ?? lengthText(node)).length;
}

/** The index of the field's child that holds a node, or -1 when the node is not in the field. */
function topIndex(root: HTMLElement, node: Node): number {
	return [...root.childNodes].findIndex((child) => child === node || child.contains(node));
}

/** The text offset of a DOM point in the field. A point inside an embed counts as the embed's start. */
function offsetOf(root: HTMLElement, node: Node, offset: number): number {
	const children = [...root.childNodes];
	const before = (count: number) => children.slice(0, count).reduce((sum, child) => sum + nodeLength(child), 0);

	if (node === root) return before(offset);

	const index = topIndex(root, node);
	const child = children[index];

	if (index === -1) return 0;
	if (child instanceof Text) return before(index) + (holders.has(child) ? 0 : offset);

	return before(index);
}

/** The DOM point for a text offset: inside a text node (or a caret holder) when one holds it, else between the field's children. */
function pointOf(root: HTMLElement, offset: number): { node: Node; offset: number } {
	let at = 0;

	for (const [index, child] of [...root.childNodes].entries()) {
		const length = nodeLength(child);

		if (child instanceof Text && offset <= at + length) return { node: child, offset: offset - at };
		if (!(child instanceof Text) && offset <= at) return { node: root, offset: index };

		at += length;
	}

	const tail = root.lastChild instanceof HTMLBRElement ? root.childNodes.length - 1 : root.childNodes.length;

	return { node: root, offset: tail };
}
