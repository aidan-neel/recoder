import { createHash } from 'node:crypto';
import { findingKind, splitCategoryTag, type DiffLine, type Finding } from '@recoder/shared';
import type { ReviewInventory } from '../inventory.js';

/** What a finding's identity is made of: never its wording or exact line, so a re-run finds the same id. */
interface FingerprintParts {
	file: string;
	category: string;
	ruleId?: string;
	smell?: string;
	/** The enclosing symbol's qualified name, from the change model. */
	symbol?: string;
	/** The inventory hunk holding the line, when no symbol encloses it. */
	hunkId?: string;
	/** The text of the line the finding sits on, so two issues in one symbol keep apart. */
	anchor?: string;
}

/** A short stable hash of `text`. */
function hash(text: string): string {
	return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** Collapses whitespace so a re-indented line keeps the same fingerprint. */
function normalizeAnchor(text: string): string {
	return text
		.split('\n')
		.map((line) => line.trim().replace(/\s+/g, ' '))
		.filter(Boolean)
		.join('\n');
}

/** Every bug category shares one class; a quality category is its own. */
function identityKind(category: string): string {
	return findingKind(category) === 'bug' ? 'bug' : category;
}

/**
 * A stable id for a finding: its file, its class, the rule or smell it names,
 * the symbol that encloses it (the hunk when none does), and the text of its
 * line. Wording, line numbers and the other findings of the run leave it
 * unchanged. Every bug category shares one class, because two lenses often
 * file one bug under different categories; quality categories each keep their
 * own. Without `anchor` it is the merge key, which nearby reports share.
 */
export function fingerprintFinding(parts: FingerprintParts): string {
	const kind = identityKind(parts.category);
	const anchor = parts.anchor === undefined ? [] : [normalizeAnchor(parts.anchor)];

	return hash(
		[parts.file, kind, parts.ruleId ?? parts.smell ?? '', parts.symbol ?? parts.hunkId ?? '', ...anchor].join('\n')
	);
}

/**
 * Where a dismissed finding sat: the fingerprint's file, class, rule or smell,
 * symbol and line text, but never the hunk, whose id holds line positions and
 * so changes whenever code above it moves.
 */
function dismissalPlace(parts: Omit<FingerprintParts, 'hunkId'> & { anchor: string }): string {
	return hash(
		[
			parts.file,
			identityKind(parts.category),
			parts.ruleId ?? parts.smell ?? '',
			parts.symbol ?? '',
			normalizeAnchor(parts.anchor)
		].join('\n')
	);
}

/** Words that say nothing about which defect a claim describes. */
const FILLER = new Set(
	'a an and any are as at be been but by can could did do does each for from had has have how if in into is it its may might must no nor not of on or should so such than that the their then there these this those to too was were what when where which while who why will with would'.split(
		' '
	)
);

/**
 * Plural and tense endings, longest first, each with the shortest stem it may
 * leave, taken off a claim word so `rejects`, `rejected` and `rejecting` meet.
 * `ed` and `es` may leave two letters, so `used` and `uses` meet `use`.
 */
const ENDINGS: [suffix: string, shortest: number][] = [
	['ing', 3],
	['ed', 2],
	['es', 2],
	['s', 3]
];

/**
 * The least share of terms two claims must hold in common (their Dice
 * coefficient) to be one defect. Reports of one defect in other words still
 * share its specifics; different defects on one line share mostly the words
 * of the place. Below it they stay apart, since a duplicate costs less than a
 * lost bug.
 */
const SAME_CLAIM = 0.4;

/**
 * A word without its plural or tense ending and without a final `e`, so
 * `cache`, `caches` and `cached` all give `cach`. A word ending in `eed`
 * (`need`, `speed`) keeps its `ed`, which is no ending there.
 */
function stem(word: string): string {
	if (word.endsWith('ss')) return word;

	const ending = ENDINGS.find(
		([suffix, shortest]) =>
			word.length - suffix.length >= shortest && word.endsWith(suffix) && !(suffix === 'ed' && word.endsWith('eed'))
	);

	const base = ending ? word.slice(0, -ending[0].length) : word;

	return base.length > 2 && base.endsWith('e') ? base.slice(0, -1) : base;
}

/** The stemmed terms of `text`, split at case changes and punctuation, lowercased and without filler. */
function termsOf(text: string): string[] {
	const words = text
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.toLowerCase()
		.split(/[^a-z0-9]+/);

	return words.filter((word) => (word.length > 1 || /\d/.test(word)) && !FILLER.has(word)).map(stem);
}

/** The parts of a finding its claim is read from; a stored finding and a fresh candidate both have them. */
interface ClaimSource {
	title?: string;
	message: string;
	claim?: { trigger: string; consequence: string; violatedContract: string };
	ruleId?: string;
	smell?: string;
	file: string;
	symbol?: string;
}

/** What two findings at one place are compared by. */
export interface ClaimTerms {
	terms: ReadonlySet<string>;
	/** A reviewer stated the claim; a detector result has none, so its title, body and rule stand for one. */
	stated: boolean;
}

/**
 * The terms of what a finding claims, the record two reports of one place
 * are compared by: its title, trigger, consequence and violated contract, its
 * body without the category tag, and the rule or smell it names. Wording
 * fades and the specifics of the defect remain. The category, line and
 * evidence ids are left out: different defects in one place share them. So
 * are the body's words that only restate `anchor`, the line the finding sits
 * on, since two defects whose bodies quote the same code would otherwise
 * merge on the quote. The claim fields keep every word: a term the reviewer
 * put in a title or consequence is part of the claim even when the line holds
 * it. Discounting the symbol and file path as well, or the anchor's terms in
 * the claim fields, split reports of one defect in the measured baseline.
 */
export function claimTerms(finding: ClaimSource, anchor: string): ClaimTerms {
	const { claim } = finding;
	const restated = new Set(termsOf(anchor));

	const stated = termsOf(
		[finding.title, claim?.trigger, claim?.consequence, claim?.violatedContract, finding.ruleId, finding.smell].join(
			' '
		)
	);

	const body = termsOf(splitCategoryTag(finding.message).body).filter((term) => !restated.has(term));

	return { terms: new Set([...stated, ...body]), stated: claim !== undefined };
}

/**
 * Whether two claims, as `claimTerms` gives them, describe one defect: their
 * Dice coefficient reaches `SAME_CLAIM`. A detector's result against a
 * reviewer's claim is measured instead by the share of the result's terms the
 * claim also holds. A reviewer's report carries a trigger, a contract and a
 * body the detector's short template never has, so their Dice coefficient
 * stays under the bar even when both describe one defect, while a different
 * defect on the line shares few of the result's terms either way.
 */
export function sameClaim(a: ClaimTerms, b: ClaimTerms): boolean {
	const shared = [...a.terms].filter((term) => b.terms.has(term)).length;

	if (a.stated !== b.stated) {
		const result = a.stated ? b : a;

		return result.terms.size > 0 && shared / result.terms.size >= SAME_CLAIM;
	}

	return a.terms.size + b.terms.size > 0 && (2 * shared) / (a.terms.size + b.terms.size) >= SAME_CLAIM;
}

/**
 * What a person's dismissal is remembered by: `place:kind:terms`, the
 * dismissed finding's place (`dismissalPlace`), whether a reviewer stated its
 * claim or a detector raised it, and its claim terms. The claim is part of the
 * key because consolidation splits one line into one finding per claim, and
 * dismissing or restoring one of them must leave the others alone. Review and
 * dismissal both compute it from the finding as stored.
 *
 * Migration: a key written before the claim was part of it is the place
 * alone. It is still read (`matchesDismissal`) and matches every claim at its
 * place, as it always did. New dismissals are written in the new form, and
 * restoring a finding removes every key, of either form, that matches it.
 */
export function dismissalFingerprint(finding: ClaimSource & { category: string }, anchor: string): string {
	const claim = claimTerms(finding, anchor);

	return [
		dismissalPlace({ ...finding, anchor }),
		claim.stated ? 'claim' : 'result',
		[...claim.terms].sort().join(' ')
	].join(':');
}

/** A key's claim, as `dismissalFingerprint` wrote it. */
function readClaim(kind: string, terms: string): ClaimTerms {
	return { stated: kind === 'claim', terms: new Set(terms ? terms.split(' ') : []) };
}

/**
 * Whether a held dismissal key drops the finding whose key is `key`: the same
 * place, and a claim `sameClaim` takes for the same defect, so a report that
 * re-words a dismissed finding is still dropped. A key in the old place-only
 * form matches every claim at its place.
 */
export function matchesDismissal(held: string, key: string): boolean {
	const [heldPlace, heldKind, heldTerms = ''] = held.split(':');
	const [place, kind, terms = ''] = key.split(':');

	if (heldPlace !== place) return false;
	if (heldKind === undefined || kind === undefined) return true;

	return sameClaim(readClaim(heldKind, heldTerms), readClaim(kind, terms));
}

/**
 * The fingerprint the `count`th finding to share one gets, counted from the
 * one holding the earliest raised report. Only the count tells them apart,
 * never their line, which a fingerprint was made to ignore.
 */
export function refineFingerprint(fingerprint: string, count: number): string {
	return hash(`${fingerprint}\n${count}`);
}

/** The id of the inventory hunk that holds `line` on `side` of `file`. */
export function hunkAt(
	inventory: ReviewInventory,
	file: string,
	line: number | undefined,
	side: 'old' | 'new'
): string | undefined {
	if (!line) return undefined;

	const entry = inventory.files.find((candidate) => candidate.path === file);

	const hunk = entry?.hunks.find((candidate) => {
		const start = side === 'old' ? candidate.oldStart : candidate.newStart;
		const count = side === 'old' ? candidate.oldCount : candidate.newCount;

		return line >= start && line < start + Math.max(count, 1);
	});

	return hunk?.id;
}

function numberOn(line: DiffLine, side: 'old' | 'new'): number | null {
	return side === 'old' ? line.oldNo : line.newNo;
}

function squash(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/** The backticked code in `texts`, three characters or longer, longest first. */
function quotedCode(texts: string[]): string[] {
	const quotes = texts.flatMap((text) => [...text.matchAll(/`([^`\n]{3,})`/g)].map((match) => squash(match[1])));

	return [...new Set(quotes)].sort((a, b) => b.length - a.length);
}

/**
 * Moves a finding onto the line holding the code it quotes. Lenses often land
 * a few lines off the expression they describe; snapping puts every report of
 * one expression on one line, so it merges and fingerprints the same. The
 * longest quote that names a line decides: the one hunk line holding it, or
 * the reported line when several do and it is one of them.
 */
export function snapToQuote(
	inventory: ReviewInventory,
	file: string,
	line: number | undefined,
	side: 'old' | 'new',
	texts: string[]
): number | undefined {
	if (!line) return line;

	const lines = inventory.diffs
		.find((entry) => entry.path === file)
		?.hunks.find((hunk) => hunk.lines.some((candidate) => numberOn(candidate, side) === line))
		?.lines.filter((candidate) => numberOn(candidate, side) !== null);

	if (!lines) return line;

	for (const quote of quotedCode(texts)) {
		const holding = lines.filter((candidate) => squash(candidate.text).includes(quote));

		if (holding.length === 1) return numberOn(holding[0], side) ?? line;
		if (holding.some((candidate) => numberOn(candidate, side) === line)) return line;
	}

	return line;
}

/** The text of the one line a finding sits on; empty for a finding without a line. */
export function lineAnchor(
	inventory: ReviewInventory,
	file: string,
	line: number | undefined,
	side: 'old' | 'new'
): string {
	return line ? anchorFn(inventory)(file, line, line, side) : '';
}

/** Looks up the diff text on one side of a file between two line numbers. */
function anchorFn(inventory: ReviewInventory) {
	return (file: string, start: number, end: number, side: 'old' | 'new'): string => {
		const diff = inventory.diffs.find((entry) => entry.path === file);

		if (!diff) return '';

		const out: string[] = [];

		for (const hunk of diff.hunks) {
			for (const line of hunk.lines) {
				const no = side === 'old' ? line.oldNo : line.newNo;

				if (no !== null && no >= start && no <= end) out.push(line.text);
			}
		}

		return out.join('\n');
	};
}

/** Findings not seen in an earlier review, deduplicated by fingerprint; unfingerprinted ones are suppressed. */
export function filterNewFindings(
	current: Finding[],
	previousFingerprints: Set<string>
): { fresh: Finding[]; suppressed: number } {
	const seen = new Set<string>();
	const fresh: Finding[] = [];
	let suppressed = 0;

	for (const finding of current) {
		const fp = finding.fingerprint;

		if (!fp || previousFingerprints.has(fp) || seen.has(fp)) {
			suppressed++;
			continue;
		}

		seen.add(fp);
		fresh.push(finding);
	}

	return { fresh, suppressed };
}
