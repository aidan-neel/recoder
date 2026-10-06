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
 * strongest first: its suggested fix edits that line and no other line of the
 * file, it cites the line and the line holds a symbol it quotes, it only cites
 * the line, or the line holds a symbol it quotes. Symbols its fix holds count
 * for nothing: they mark where the fix already exists, not where it is missing.
 */
const TIERS = ['patch-target', 'cited-symbol', 'cited', 'quoted-symbol'] as const;

/** The changed line a candidate is moved onto, and the evidence that picked it. */
export interface AnchorChoice {
	line: number;
	tier: (typeof TIERS)[number];
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
	return diffLines(inventory, file)
		.filter((line) => line.type === 'add' && line.newNo !== null && holdsCode(line.text))
		.map((line) => ({ file, line: line.newNo!, text: line.text }));
}

/** Every line of the file's diff: added, removed and context. */
function diffLines(inventory: ReviewInventory, file: string) {
	return (inventory.diffs.find((entry) => entry.path === file)?.hunks ?? []).flatMap((hunk) => hunk.lines);
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
	const prior = diffLines(inventory, file).filter((line) => line.type !== 'add');

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
 * How the candidate's prose names a line of its own file: its full path, or its
 * basename when no other changed file shares it, then `:12` or `:12-14`.
 */
function lineReference(candidate: CandidateFinding, inventory: ReviewInventory): RegExp {
	const base = candidate.file.split('/').at(-1) ?? candidate.file;
	const shared = inventory.files.filter((entry) => entry.path.split('/').at(-1) === base).length > 1;
	const names = shared || base === candidate.file ? [candidate.file] : [candidate.file, base];

	return new RegExp(`(?<![\\w/.-])(?:${names.map(escapeRegExp).join('|')}):(\\d+)(?:\\s*[-–]\\s*(\\d+))?(?!\\d)`, 'g');
}

/**
 * The new-side line ranges the candidate cites in its own file: execution path
 * steps and related locations there, and `src/name.ts:12-14` in its prose.
 * A bare "lines 12 to 14" names no file, so it cites nothing.
 */
function citedRanges(candidate: CandidateFinding, inventory: ReviewInventory): [number, number][] {
	const steps = [...(candidate.claim?.executionPath ?? []), ...(candidate.relatedLocations ?? [])]
		.filter((step) => step.file === candidate.file && step.line && !('side' in step && step.side === 'old'))
		.map((step): [number, number] => [step.line!, ('endLine' in step && step.endLine) || step.line!]);

	const refs = lineReference(candidate, inventory);

	const quoted = candidateProse(candidate).flatMap((text) =>
		[...text.matchAll(refs)].map((match): [number, number] => [Number(match[1]), Number(match[2] ?? match[1])])
	);

	return [...steps, ...quoted].filter(([start, end]) => end >= start);
}

/**
 * Code-like identifiers in the candidate's backticked quotes, without paths
 * and without any identifier its fix holds (what it replaces is the reported
 * line itself, and what it adds marks where the fix exists, not where it is missing).
 */
function quotedSymbols(candidate: CandidateFinding): Set<string> {
	const fixed = new Set((candidate.fix ?? []).flatMap((edit) => [...identifiers(`${edit.find}\n${edit.replace}`)]));

	const spans = candidateProse(candidate)
		.flatMap((text) => [...text.matchAll(/`([^`\n]{3,})`/g)].map((match) => match[1]))
		.filter((span) => !span.includes('/') && !/\.\w+:\d/.test(span));

	return new Set(
		spans.flatMap((span) =>
			[...identifiers(span)].filter((id) => !fixed.has(id) && (/[a-z][A-Z]|_|\$/.test(id) || span.includes(`${id}(`)))
		)
	);
}

/**
 * The added lines the candidate's fix edits: the first line of an edit's
 * `find` in the candidate's file, when it is on exactly one added line and on
 * no context or removed line, so the fix can only mean that line.
 */
function patchTargets(candidate: CandidateFinding, inventory: ReviewInventory): Set<number> {
	const lines = diffLines(inventory, candidate.file);

	const targets = (candidate.fix ?? [])
		.filter((edit) => edit.file === candidate.file)
		.map((edit) => squash(edit.find.split('\n').find((line) => line.trim()) ?? ''))
		.filter((text) => text.length >= 8);

	return new Set(
		targets.flatMap((target) => {
			const holding = lines.filter((line) => squash(line.text).includes(target));
			const [only] = holding;

			return holding.length === 1 && only.type === 'add' && only.newNo !== null ? [only.newNo] : [];
		})
	);
}

function squash(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/** The strongest tier a changed line reaches, with the cited symbols it holds; null when nothing ties it to the claim. */
function tierOf(
	line: ChangedLine,
	evidence: { targets: Set<number>; ranges: [number, number][]; quoted: Set<string> }
): { tier: AnchorChoice['tier']; terms: string[] } | null {
	const terms = [...evidence.quoted].filter((id) => holds(line.text, id));
	const cited = evidence.ranges.some(([start, end]) => line.line >= start && line.line <= end);

	if (evidence.targets.has(line.line)) return { tier: 'patch-target', terms: [] };
	if (cited && terms.length) return { tier: 'cited-symbol', terms };
	if (cited) return { tier: 'cited', terms: [] };
	if (terms.length) return { tier: 'quoted-symbol', terms };

	return null;
}

/**
 * The changed line in the candidate's own file that its evidence ties to the
 * claim. A quoted symbol counts only when the change introduces it (it is on
 * no context or removed line of the file's diff). The strongest tier wins,
 * then the line nearest the reported one. Two lines equally near in the
 * strongest tier are a tie the diff can't settle.
 */
export function chooseAnchor(candidate: CandidateFinding, inventory: ReviewInventory): AnchorChoice | AnchorMiss {
	const prior = priorIdentifiers(inventory, candidate.file);
	const introduced = (ids: Set<string>) => new Set([...ids].filter((id) => !prior.has(id)));

	const evidence = {
		targets: patchTargets(candidate, inventory),
		ranges: citedRanges(candidate, inventory),
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
