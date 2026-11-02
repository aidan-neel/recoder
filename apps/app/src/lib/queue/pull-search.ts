import { queryTerms } from '../settings/model-options';
import type { QueueEntry } from './queue';

/** A character that starts a new word: `rate` in `per-tenant rate`, `auth` in `agent/auth-fix`. */
const BOUNDARY = /[\s#/(:._-]/;

/** 2 when the term starts a word in the text, 1 when it sits inside one, else 0. */
function wordScore(term: string, text: string): number {
	let at = text.indexOf(term);
	let inside = false;

	while (at !== -1) {
		if (at === 0 || BOUNDARY.test(text[at - 1])) return 2;

		inside = true;
		at = text.indexOf(term, at + 1);
	}

	return inside ? 1 : 0;
}

/** True when the term's letters appear in order in the text: `rtlim` in `rate limiting`. */
function inOrder(term: string, text: string): boolean {
	let at = 0;

	for (const char of term) {
		at = text.indexOf(char, at) + 1;

		if (at === 0) return false;
	}

	return true;
}

/** How well one typed word matches the pull request's number. */
function numberScore(term: string, number: number): number {
	const digits = term.replace(/^[#!]/, '');

	if (!/^\d+$/.test(digits)) return 0;
	if (String(number) === digits) return 8;

	return String(number).startsWith(digits) ? 4 : 0;
}

/**
 * How well one typed word matches a pull request. The number counts most,
 * then the title, then the repository, author and branch; letters typed in
 * order through the title still match, faintly, so a typo or an abbreviation
 * finds it.
 */
function termScore(term: string, entry: QueueEntry): number {
	const { pull } = entry;
	const title = pull.title.toLowerCase();
	const others = [entry.repo, pull.author, pull.headRef].map((field) => field.toLowerCase());

	return Math.max(
		numberScore(term, pull.number),
		wordScore(term, title) * 3,
		...others.map((field) => wordScore(term, field) * 2),
		term.length >= 3 && inOrder(term, title) ? 1 : 0
	);
}

/** The pull request's score for the search, 0 when any typed word misses. */
function entryScore(terms: string[], entry: QueueEntry): number {
	let total = 0;

	for (const term of terms) {
		const score = termScore(term, entry);

		if (score === 0) return 0;

		total += score;
	}

	return total;
}

/**
 * Open pull requests that match the search, best first, at most `limit`.
 * Every typed word must match; ties keep the order the entries came in, so
 * the queue's own order breaks them.
 */
export function searchPulls(entries: QueueEntry[], search: string, limit: number): QueueEntry[] {
	const terms = queryTerms(search);

	if (terms.length === 0) return [];

	return entries
		.map((entry, index) => ({ entry, index, score: entryScore(terms, entry) }))
		.filter((match) => match.score > 0)
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.slice(0, limit)
		.map((match) => match.entry);
}
