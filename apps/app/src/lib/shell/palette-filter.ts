import { queryTerms } from '../settings/model-options';

/** A character that starts a new word in a row's text. */
const BOUNDARY = /[\s#/(:.-]/;

/** How well one typed word matches: 3 at the start of a word in the text, 2 inside one, 1 at the start of a keyword, else 0. */
function termScore(term: string, text: string, keywords: string[]): number {
	const at = text.indexOf(term);

	if (at === 0 || (at > 0 && BOUNDARY.test(text[at - 1]))) return 3;
	if (at > 0) return 2;

	return keywords.some((keyword) => keyword.startsWith(term)) ? 1 : 0;
}

/**
 * Scores a palette row for the query, from 0 (hidden) to 1. Every word typed
 * must appear in the row's text or start one of its keywords, so a keyword
 * never matches on scattered letters. Rows whose own text matches rank first.
 */
export function paletteScore(value: string, search: string, keywords: string[] = []): number {
	const terms = queryTerms(search);

	if (terms.length === 0) return 1;

	const text = value.toLowerCase();
	const words = keywords.map((keyword) => keyword.toLowerCase());
	let total = 0;

	for (const term of terms) {
		const score = termScore(term, text, words);

		if (score === 0) return 0;

		total += score;
	}

	return total / (terms.length * 3);
}
