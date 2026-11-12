import { findLinks, type TextRange } from './link-find';

/**
 * A link field's content: the plain text, URLs in full, and which of its
 * links show as embeds. Embeds are sorted, never overlap, and each one spans
 * a whole URL. A link that is still being typed is text until it ends.
 */
export interface LinkDoc {
	readonly text: string;
	readonly links: readonly TextRange[];
}

/**
 * A zero-width space: the one character of a caret holder, a text node the view puts beside an embed that has no
 * text next to it. It is the view's own and never part of the content.
 */
export const CARET_HOLDER = '\u200B';

/** One run of a link field's content: text, or an embedded link. */
export type Segment = { kind: 'text'; text: string } | { kind: 'link'; url: string };

/** White space ends the word a link is typed in. */
const SPACE = /\s/u;

/** The content of text that arrives whole (a value from outside, a paste): every link in it is an embed. */
export function docFromText(text: string): LinkDoc {
	return embedLinks({ text, links: [] }, null);
}

/** The content as runs of text and links, in order; text runs are never empty. */
export function segmentsOf(doc: LinkDoc): Segment[] {
	const segments: Segment[] = [];
	let at = 0;

	for (const link of doc.links) {
		if (link.start > at) segments.push({ kind: 'text', text: doc.text.slice(at, link.start) });

		segments.push({ kind: 'link', url: doc.text.slice(link.start, link.end) });
		at = link.end;
	}

	if (at < doc.text.length) segments.push({ kind: 'text', text: doc.text.slice(at) });

	return segments;
}

/** The content the runs describe: the inverse of `segmentsOf`. */
export function docFromSegments(segments: readonly Segment[]): LinkDoc {
	let text = '';
	const links: TextRange[] = [];

	for (const segment of segments) {
		if (segment.kind === 'text') {
			text += segment.text;

			continue;
		}

		links.push({ start: text.length, end: text.length + segment.url.length });
		text += segment.url;
	}

	return { text, links };
}

/**
 * Embeds every link in the text that is not one already, does not overlap
 * one, and does not touch `keep` (the word the caret is typing in, so a URL
 * never turns into an embed half typed).
 */
export function embedLinks(doc: LinkDoc, keep: TextRange | null): LinkDoc {
	const added = findLinks(doc.text).filter(
		(link) => !doc.links.some((embed) => overlaps(embed, link)) && !(keep && touches(keep, link))
	);

	if (added.length === 0) return doc;

	return { text: doc.text, links: [...doc.links, ...added].sort((a, b) => a.start - b.start) };
}

/** The run of non-space characters around the caret: the word being typed. Empty between two spaces. */
export function wordAround(text: string, caret: number): TextRange {
	let start = caret;
	let end = caret;

	while (start > 0 && !SPACE.test(text[start - 1])) start -= 1;
	while (end < text.length && !SPACE.test(text[end])) end += 1;

	return { start, end };
}

/** The embed that holds `offset` strictly inside it, if any. */
export function linkAround(doc: LinkDoc, offset: number): TextRange | undefined {
	return doc.links.find((link) => link.start < offset && offset < link.end);
}

/** The embed that ends at `offset`, if any. */
export function linkBefore(doc: LinkDoc, offset: number): TextRange | undefined {
	return doc.links.find((link) => link.end === offset);
}

/** The embed that starts at `offset`, if any. */
export function linkAfter(doc: LinkDoc, offset: number): TextRange | undefined {
	return doc.links.find((link) => link.start === offset);
}

/** The range grown to hold every embed it cuts into, so an embed is always taken whole. */
export function snapRange(doc: LinkDoc, range: TextRange): TextRange {
	let { start, end } = range;

	for (const link of doc.links) {
		if (link.start < start && start < link.end) start = link.start;
		if (link.start < end && end < link.end) end = link.end;
	}

	return { start, end };
}

/**
 * Replaces a range with text. Embeds the range covers go; embeds after it
 * move with the text; an insertion at an embed's edge stays outside it.
 */
export function replaceRange(doc: LinkDoc, range: TextRange, insert: string): LinkDoc {
	const { start, end } = snapRange(doc, range);
	const shift = insert.length - (end - start);

	const links = doc.links.flatMap((link) => {
		if (link.end <= start) return [link];
		if (link.start >= end) return [{ start: link.start + shift, end: link.end + shift }];

		return [];
	});

	return { text: doc.text.slice(0, start) + insert + doc.text.slice(end), links };
}

/** What Backspace removes at a caret: the embed that ends there, else the character before it. */
export function backwardRange(doc: LinkDoc, caret: number): TextRange {
	const link = linkBefore(doc, caret);

	if (link) return link;

	return { start: Math.max(0, caret - charWidth(doc.text, caret - 1, -1)), end: caret };
}

/** What Delete removes at a caret: the embed that starts there, else the character after it. */
export function forwardRange(doc: LinkDoc, caret: number): TextRange {
	const link = linkAfter(doc, caret);

	if (link) return link;

	return { start: caret, end: Math.min(doc.text.length, caret + charWidth(doc.text, caret, 1)) };
}

/** The text an insertion may keep under a length limit: as much as fits after the range it replaces. */
export function fitInsert(doc: LinkDoc, range: TextRange, insert: string, maxLength: number | undefined): string {
	if (maxLength === undefined) return insert;

	const { start, end } = snapRange(doc, range);
	const room = maxLength - (doc.text.length - (end - start));

	let kept = '';

	for (const char of insert) {
		if (kept.length + char.length > room) break;

		kept += char;
	}

	return kept;
}

/** True when two ranges share at least one character. */
function overlaps(a: TextRange, b: TextRange): boolean {
	return a.start < b.end && b.start < a.end;
}

/** True when two ranges overlap or meet, so an empty word at a link's edge still keeps it. */
function touches(a: TextRange, b: TextRange): boolean {
	return a.start <= b.end && b.start <= a.end;
}

/** 2 when the character at `index` is half of a surrogate pair whose other half lies in `direction`, else 1. */
function charWidth(text: string, index: number, direction: 1 | -1): number {
	const code = text.charCodeAt(index);
	const low = direction === -1 && code >= 0xdc00 && code <= 0xdfff;
	const high = direction === 1 && code >= 0xd800 && code <= 0xdbff;

	return low || high ? 2 : 1;
}
