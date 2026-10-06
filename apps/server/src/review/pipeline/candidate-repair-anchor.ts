import type { CandidateFinding } from './consolidate.js';
import type { ReviewInventory } from './inventory.js';

/** A line the change added on the new side, which a candidate can be anchored on. */
export interface ChangedLine {
	file: string;
	line: number;
	text: string;
}

/**
 * How strongly the candidate's own evidence ties a changed line to its claim,
 * strongest first: its suggested fix edits that line, it cites the line and the
 * line holds a symbol it names, it only cites the line, the line holds a symbol
 * its fix introduces, or the line holds code it quotes.
 */
const TIERS = ['patch-target', 'cited-symbol', 'cited', 'fix-symbol', 'quoted-symbol'] as const;

type AnchorTier = (typeof TIERS)[number];

/** The changed line a candidate is moved onto, and the evidence that picked it. */
export interface AnchorChoice {
	line: number;
	tier: AnchorTier;
	/** The cited symbols the line holds, for the symbol tiers. */
	terms: string[];
	text: string;
}

/** Why no single changed line could be chosen from the evidence alone. */
export type AnchorMiss = { miss: 'none' | 'tie'; reason: string };

const COMMENT = /^\s*(\/\/|\/\*|\*|#|<!--)/;

/** Words that are code in every language, so naming one links a line to nothing. */
const KEYWORDS = new Set([
	'async',
	'await',
	'break',
	'const',
	'continue',
	'default',
	'export',
	'false',
	'function',
	'import',
	'null',
	'return',
	'this',
	'throw',
	'true',
	'typeof',
	'undefined',
	'void',
	'while'
]);

/** Whether an added line holds code a finding can sit on: not a comment, and more than brackets and punctuation. */
function holdsCode(text: string): boolean {
	return /\w/.test(text) && !COMMENT.test(text);
}

/** The added lines of one file that hold code; blank, comment and bracket-only lines can't carry a finding's anchor. */
export function changedLines(inventory: ReviewInventory, file: string): ChangedLine[] {
	const diff = inventory.diffs.find((entry) => entry.path === file);

	return (diff?.hunks ?? [])
		.flatMap((hunk) => hunk.lines)
		.filter((line) => line.type === 'add' && line.newNo !== null && holdsCode(line.text))
		.map((line) => ({ file, line: line.newNo!, text: line.text }));
}

function identifiers(text: string): Set<string> {
	return new Set([...text.matchAll(/[A-Za-z_$][\w$]{3,}/g)].map((match) => match[0]).filter((id) => !KEYWORDS.has(id)));
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function holds(text: string, id: string): boolean {
	return new RegExp(`(^|[^\\w$])${escapeRegExp(id)}($|[^\\w$])`).test(text);
}

/** Identifiers on the file's context and removed lines: what the file held before, as far as the diff shows. */
function priorIdentifiers(inventory: ReviewInventory, file: string): Set<string> {
	const diff = inventory.diffs.find((entry) => entry.path === file);
	const prior = (diff?.hunks ?? []).flatMap((hunk) => hunk.lines).filter((line) => line.type !== 'add');

	return new Set(prior.flatMap((line) => [...identifiers(line.text)]));
}

/** The prose a candidate's line references and quoted code sit in. */
export function candidateProse(candidate: CandidateFinding): string[] {
	const claim = candidate.claim;

	return [
		candidate.title ?? '',
		candidate.message,
		claim?.trigger ?? '',
		claim?.consequence ?? '',
		claim?.violatedContract ?? '',
		claim?.existingGuard ?? '',
		...(claim?.executionPath ?? []).map((step) => step.note ?? '')
	];
}

/**
 * The new-side line ranges the candidate cites in its own file: execution path
 * steps and related locations there, and `name.ts:12-14` or `lines 12-14` in its prose.
 */
function citedRanges(candidate: CandidateFinding): [number, number][] {
	const steps = [...(candidate.claim?.executionPath ?? []), ...(candidate.relatedLocations ?? [])]
		.filter((step) => step.file === candidate.file && step.line && !('side' in step && step.side === 'old'))
		.map((step): [number, number] => [step.line!, ('endLine' in step && step.endLine) || step.line!]);

	const name = escapeRegExp(candidate.file.split('/').at(-1) ?? candidate.file);

	const refs = new RegExp(
		`${name}:(\\d+)(?:\\s*[-–]\\s*(\\d+))?|\\blines? (\\d+)(?:\\s*(?:-|–|to|and)\\s*(\\d+))?`,
		'g'
	);

	const quoted = candidateProse(candidate).flatMap((text) =>
		[...text.matchAll(refs)].map((match): [number, number] => {
			const start = Number(match[1] ?? match[3]);

			return [start, Number(match[2] ?? match[4] ?? start)];
		})
	);

	return [...steps, ...quoted].filter(([start, end]) => end >= start);
}

/** Identifiers the candidate's fix adds to its file: what the fix says is missing at the reported line. */
function fixSymbols(candidate: CandidateFinding): Set<string> {
	const edits = (candidate.fix ?? []).filter((edit) => edit.file === candidate.file);
	const found = new Set(edits.flatMap((edit) => [...identifiers(edit.find)]));

	return new Set(edits.flatMap((edit) => [...identifiers(edit.replace)]).filter((id) => !found.has(id)));
}

/**
 * Code-like identifiers in the candidate's backticked quotes, without paths
 * and without what its fix replaces (that text is the reported line itself).
 */
function quotedSymbols(candidate: CandidateFinding): Set<string> {
	const replaced = new Set((candidate.fix ?? []).flatMap((edit) => [...identifiers(edit.find)]));

	const spans = candidateProse(candidate)
		.flatMap((text) => [...text.matchAll(/`([^`\n]{3,})`/g)].map((match) => match[1]))
		.filter((span) => !span.includes('/') && !/\.\w+:\d/.test(span));

	return new Set(
		spans.flatMap((span) =>
			[...identifiers(span)].filter(
				(id) => !replaced.has(id) && (/[a-z][A-Z]|_|\$/.test(id) || span.includes(`${id}(`))
			)
		)
	);
}

/** The first line of each fix edit in the candidate's file, when long enough to place it. */
function fixTargets(candidate: CandidateFinding): string[] {
	return (candidate.fix ?? [])
		.filter((edit) => edit.file === candidate.file)
		.map((edit) => squash(edit.find.split('\n').find((line) => line.trim()) ?? ''))
		.filter((text) => text.length >= 8);
}

function squash(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/** The strongest tier a changed line reaches, with the cited symbols it holds; null when nothing ties it to the claim. */
function tierOf(
	line: ChangedLine,
	evidence: { targets: string[]; ranges: [number, number][]; fix: Set<string>; quoted: Set<string> }
): { tier: AnchorTier; terms: string[] } | null {
	const fixTerms = [...evidence.fix].filter((id) => holds(line.text, id));
	const quotedTerms = [...evidence.quoted].filter((id) => holds(line.text, id));
	const cited = evidence.ranges.some(([start, end]) => line.line >= start && line.line <= end);
	const terms = [...new Set([...fixTerms, ...quotedTerms])];

	if (evidence.targets.some((target) => squash(line.text).includes(target))) return { tier: 'patch-target', terms: [] };
	if (cited && terms.length) return { tier: 'cited-symbol', terms };
	if (cited) return { tier: 'cited', terms: [] };
	if (fixTerms.length) return { tier: 'fix-symbol', terms: fixTerms };
	if (quotedTerms.length) return { tier: 'quoted-symbol', terms: quotedTerms };

	return null;
}

/**
 * The changed line in the candidate's own file that its evidence ties to the
 * claim. A cited symbol counts only when the change introduces it (it is on no
 * context or removed line of the file's diff). The strongest tier wins, then the line nearest the reported one. Two
 * lines equally near in the strongest tier are a tie the diff can't settle.
 */
export function chooseAnchor(candidate: CandidateFinding, inventory: ReviewInventory): AnchorChoice | AnchorMiss {
	const prior = priorIdentifiers(inventory, candidate.file);
	const introduced = (ids: Set<string>) => new Set([...ids].filter((id) => !prior.has(id)));

	const evidence = {
		targets: fixTargets(candidate),
		ranges: citedRanges(candidate),
		fix: introduced(fixSymbols(candidate)),
		quoted: introduced(quotedSymbols(candidate))
	};

	const ranked = changedLines(inventory, candidate.file).flatMap((line) => {
		const tier = tierOf(line, evidence);

		return tier ? [{ ...line, ...tier }] : [];
	});

	const best = TIERS.find((tier) => ranked.some((line) => line.tier === tier));

	if (!best) return { miss: 'none', reason: `no changed line in ${candidate.file} holds code the candidate cites` };

	const reported = candidate.line ?? 0;
	const distance = (line: ChangedLine) => Math.abs(line.line - reported);
	const inTier = ranked.filter((line) => line.tier === best).sort((a, b) => distance(a) - distance(b));
	const [first, second] = inTier;

	if (second && distance(second) === distance(first)) {
		return { miss: 'tie', reason: `lines ${first.line} and ${second.line} are equally supported (${best})` };
	}

	return { line: first.line, tier: best, terms: first.terms, text: first.text.trim() };
}
