import { queryTerms } from '../settings/model-options';
import type { QueueEntry } from './queue';

/** A character that starts a new word: `rate` in `per-tenant rate`, `auth` in `agent/auth-fix`. */
const BOUNDARY = /[\s#/(:._`,'"[-]/;

/** Typed words shorter than this only match from the start of a word: `ca` finds `cache`, not `vacation`. */
const INSIDE_MIN = 3;

/** Letters typed in order may spread over at most this many characters per letter typed: `rtlim` over `rate limi`. */
const SPREAD = 2;

/** How a typed word met a pull request: its score, and whether only its letters in order matched. */
interface TermMatch {
	score: number;
	loose: boolean;
}

const MISS: TermMatch = { score: 0, loose: false };

function startsWord(text: string, at: number): boolean {
	return at === 0 || BOUNDARY.test(text[at - 1]);
}

function endsWord(text: string, at: number): boolean {
	return at === text.length || BOUNDARY.test(text[at]);
}

/** 3 when the term is a whole word in the text, 2 when it starts one, 1 when it sits inside one (3+ letters), else 0. */
function wordScore(term: string, text: string): number {
	let best = 0;

	for (let at = text.indexOf(term); at !== -1 && best < 3; at = text.indexOf(term, at + 1)) {
		if (!startsWord(text, at)) best = Math.max(best, term.length >= INSIDE_MIN ? 1 : 0);
		else best = endsWord(text, at + term.length) ? 3 : 2;
	}

	return best;
}

/** How many characters the term's letters span when matched in order from `start`, or Infinity when they run out. */
function spanFrom(term: string, text: string, start: number): number {
	let at = start;

	for (const char of term.slice(1)) {
		at = text.indexOf(char, at + 1);

		if (at === -1) return Infinity;
	}

	return at - start + 1;
}

/**
 * True when the term's letters appear in order in the text, starting a word
 * and packed close together: `rtlim` in `rate limiting`, `limting` in
 * `limiting`. Letters scattered across the title (`fix` through `refactor
 * (cli): extract`) do not count.
 */
function compactInOrder(term: string, text: string): boolean {
	const limit = term.length * SPREAD;

	for (let at = text.indexOf(term[0]); at !== -1; at = text.indexOf(term[0], at + 1)) {
		if (startsWord(text, at) && spanFrom(term, text, at) <= limit) return true;
	}

	return false;
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
 * then the title, then the repository, author and branch. Letters typed in
 * order through a title word match loosely, so a typo or an abbreviation
 * still finds it.
 */
function termMatch(term: string, entry: QueueEntry): TermMatch {
	const { pull } = entry;
	const title = pull.title.toLowerCase();
	const others = [entry.repo, pull.author, pull.headRef].map((field) => field.toLowerCase());

	const score = Math.max(
		numberScore(term, pull.number),
		wordScore(term, title) * 3,
		...others.map((field) => wordScore(term, field) * 2)
	);

	if (score > 0) return { score, loose: false };

	return term.length >= INSIDE_MIN && compactInOrder(term, title) ? { score: 1, loose: true } : MISS;
}

/** The pull request's match for the search: the sum over the typed words, a miss when any word misses. */
function entryMatch(terms: string[], entry: QueueEntry): TermMatch {
	let score = 0;
	let loose = false;

	for (const term of terms) {
		const match = termMatch(term, entry);

		if (match.score === 0) return MISS;

		score += match.score;
		loose ||= match.loose;
	}

	return { score, loose };
}

/**
 * Open pull requests that match the search, best first, at most `limit`.
 * Every typed word must match. Loose matches (letters in order) only show
 * when nothing matches as typed. Ties keep the order the entries came in, so
 * the queue's own order breaks them.
 */
export function searchPulls(entries: QueueEntry[], search: string, limit: number): QueueEntry[] {
	const terms = queryTerms(search);

	if (terms.length === 0) return [];

	const matches = entries
		.map((entry, index) => ({ entry, index, ...entryMatch(terms, entry) }))
		.filter((match) => match.score > 0);

	const exact = matches.some((match) => !match.loose);

	return matches
		.filter((match) => !exact || !match.loose)
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.slice(0, limit)
		.map((match) => match.entry);
}
