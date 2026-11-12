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

const BRACKETS = new Set([...CLOSERS.keys(), ...CLOSERS.values()]);

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

/**
 * The end once sentence punctuation and unopened closing brackets are dropped
 * from the tail. The brackets are counted once and the count follows the
 * cut, so a long run of closers costs one pass, not one pass each.
 */
function trimTrailing(text: string, start: number, end: number): number {
	const brackets = countBrackets(text, start, end);
	let cut = end;

	while (cut > start) {
		const last = text[cut - 1];
		const opener = CLOSERS.get(last);
		const unopened = opener !== undefined && countOf(brackets, opener) < countOf(brackets, last);

		if (!TRAILING.has(last) && !unopened) break;

		if (unopened) brackets.set(last, countOf(brackets, last) - 1);

		cut -= 1;
	}

	return cut;
}

/** How many of each bracket, opener or closer, a stretch of the text holds. */
function countBrackets(text: string, start: number, end: number): Map<string, number> {
	const counts = new Map<string, number>();

	for (let index = start; index < end; index += 1) {
		const character = text[index];

		if (BRACKETS.has(character)) counts.set(character, countOf(counts, character) + 1);
	}

	return counts;
}

function countOf(counts: Map<string, number>, bracket: string): number {
	return counts.get(bracket) ?? 0;
}
