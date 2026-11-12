/** Where a link sits in a text: `text.slice(start, end)` is its URL. */
export interface TextRange {
	start: number;
	end: number;
}

/** The start of a link: `http://` or `https://`, in any case, not glued to a word before it. */
const SCHEME = /(?<![\p{L}\p{N}_])https?:\/\//giu;

/** A character that can never be part of a link: white space, angle brackets, quotes and backticks. */
const STOP = /[\s<>"`]/u;

/** Punctuation that ends a sentence or a clause, never a link. */
const TRAILING = new Set(['.', ',', '!', '?', ':', ';', "'", '’', '”', '*', '_']);

/** Closing brackets, with their openers: one at the end stays in the link only when the link opened it. */
const CLOSERS = new Map([
	[')', '('],
	[']', '['],
	['}', '{']
]);

/**
 * Every `http:` and `https:` link in the text, in order. A link runs to the
 * next space, quote or angle bracket. Punctuation that belongs to the sentence
 * after it (`.` `,` `!` `?` `:` `;` and quotes) is left out, and so is a
 * closing bracket the link did not open: `(see https://x.dev/a)` keeps the
 * `)` out, `https://x.dev/Foo_(bar)` keeps it in. In Markdown, `[docs](url)`
 * yields the URL alone. Other schemes (`javascript:`, `data:`, `file:`) are
 * never links.
 */
export function findLinks(text: string): TextRange[] {
	const found: TextRange[] = [];

	for (const match of text.matchAll(SCHEME)) {
		const start = match.index;
		const end = trimTrailing(text, start, runEnd(text, start + match[0].length));

		if (end > start + match[0].length && isWebUrl(text.slice(start, end))) found.push({ start, end });
	}

	return found;
}

/** True when the text parses as an `http:` or `https:` URL with a host. */
function isWebUrl(text: string): boolean {
	try {
		const url = new URL(text);

		return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
	} catch {
		return false;
	}
}

/** Where the run of link characters from `from` ends. */
function runEnd(text: string, from: number): number {
	let end = from;

	while (end < text.length && !STOP.test(text[end])) end += 1;

	return end;
}

/** The end once sentence punctuation and unopened closing brackets are dropped from the tail. */
function trimTrailing(text: string, start: number, end: number): number {
	let cut = end;

	while (cut > start) {
		const last = text[cut - 1];

		if (TRAILING.has(last)) {
			cut -= 1;

			continue;
		}

		const opener = CLOSERS.get(last);

		if (opener === undefined || balanced(text.slice(start, cut), opener, last)) break;

		cut -= 1;
	}

	return cut;
}

/** True when the link holds at least as many openers as closers, so its last closer is its own. */
function balanced(link: string, opener: string, closer: string): boolean {
	return link.split(opener).length >= link.split(closer).length;
}
