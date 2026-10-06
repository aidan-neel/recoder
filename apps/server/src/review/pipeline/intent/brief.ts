import { symbolAt, unitContext } from '../change-model/lookup.js';
import type { ChangeModel } from '../change-model/types.js';
import type { ReviewInventory } from '../inventory.js';
import type { ReviewUnit, UnitScope } from '../units.js';
import type { BriefOmission, ChangeIntent, CodeClaim } from './types.js';

/** The diff one brief call reads at most; a small model has to hold all of it at once. */
const MAX_DIFF_CHARS = 24_000;
const MAX_DECLARATION_CHARS = 8_000;

/** Per unit and list. A reviewer is shown only its own unit's claims, so this is what one reviewer reads at most. */
const MAX_CODE_CLAIMS = 12;

const SIGN = { add: '+', del: '-', context: ' ' } as const;

/** One file's hunks with each new-side line numbered; a removed line has no number, so every cited line is on the new side. */
function fileDiff(inventory: ReviewInventory, path: string): string {
	const diff = inventory.diffs.find((entry) => entry.path === path);

	const hunks = (diff?.hunks ?? []).map((hunk) =>
		[hunk.header, ...hunk.lines.map((line) => `${SIGN[line.type]}${line.newNo ?? ''}| ${line.text}`)].join('\n')
	);

	return [`--- ${path}`, ...hunks].join('\n');
}

/**
 * Each file's share of `cap` characters: a file smaller than an even split
 * keeps all of it and leaves the rest to the larger ones, so no file is cut
 * to nothing because an earlier one is large.
 */
function shares(sizes: number[], cap: number): number[] {
	const order = sizes.map((size, index) => ({ size, index })).sort((a, b) => a.size - b.size || a.index - b.index);
	const result = sizes.map(() => 0);
	let left = cap;

	for (const [position, { size, index }] of order.entries()) {
		result[index] = Math.min(size, Math.floor(left / (order.length - position)));
		left -= result[index];
	}

	return result;
}

/** A file's diff cut at the last line break within `chars`, with a note of how many lines were left out. */
function clip(text: string, chars: number): string {
	if (text.length <= chars) return text;

	const end = text.lastIndexOf('\n', chars);
	const kept = text.slice(0, end > 0 ? end : chars);
	const rest = text.slice(kept.length).split('\n').filter(Boolean).length;

	return `${kept}\n…${rest} more line${rest === 1 ? '' : 's'} of this file's diff not shown`;
}

/**
 * What one unit's summary is written from: the parser's changed declarations
 * with their references and tests, then every file's diff. A diff larger
 * than one call reads is clipped file by file to each one's share, so a
 * large file never hides the others. Same inventory, model and unit, same
 * text, so it can key a cache.
 */
export function unitInput(
	inventory: ReviewInventory,
	model: ChangeModel | null,
	scope: UnitScope
): { text: string; clipped: boolean } {
	const diffs = scope.map((entry) => fileDiff(inventory, entry.path));

	const limits = shares(
		diffs.map((text) => text.length),
		MAX_DIFF_CHARS
	);

	const shown = diffs.map((text, index) => clip(text, limits[index]));
	const declarations = model ? unitContext(model, scope, MAX_DECLARATION_CHARS) : '';

	const diff = `Diff (new-side line numbers before each line; removed lines have none):\n${shown.join('\n\n')}`;

	return {
		text: [declarations, diff].filter(Boolean).join('\n\n'),
		clipped: shown.some((text, index) => text !== diffs[index])
	};
}

/** Text a model copied from the reply template or left as filler: `...`, `…`, `N/A`, or nothing. */
export function isFiller(text: string): boolean {
	return /^[\s.…\-–—_?]*$/.test(text) || /^(n\/a|none|todo|tbd)$/i.test(text.trim());
}

/** Whether the line is one the diff shows on the new side of the file; any line counts in a file with none, a deleted one. */
function inDiff(inventory: ReviewInventory, path: string, line: number): boolean {
	const hunks = inventory.diffs.find((entry) => entry.path === path)?.hunks ?? [];
	const shown = hunks.flatMap((hunk) => hunk.lines.flatMap((entry) => entry.newNo ?? []));

	return !shown.length || shown.includes(line);
}

/** The new side of the hunk that shows `line`, or the line alone when none does. */
function hunkRange(inventory: ReviewInventory, path: string, line: number): { start: number; end: number } {
	const hunk = inventory.diffs
		.find((entry) => entry.path === path)
		?.hunks.find((entry) => entry.newCount && entry.newStart <= line && line < entry.newStart + entry.newCount);

	return hunk ? { start: hunk.newStart, end: hunk.newStart + hunk.newCount - 1 } : { start: line, end: line };
}

/** Up to `max` claims, each file's next one in turn, so one file's many claims never crowd out another's. */
function acrossFiles<T extends { file: string }>(claims: T[], max: number): T[] {
	const byFile = new Map<string, T[]>();

	for (const claim of claims) byFile.set(claim.file, [...(byFile.get(claim.file) ?? []), claim]);

	const queues = [...byFile.values()];
	const longest = Math.max(0, ...queues.map((queue) => queue.length));

	return Array.from({ length: longest }, (_, round) => queues.flatMap((queue) => queue[round] ?? []))
		.flat()
		.slice(0, max);
}

/** A claim pinned to its source, before ids are given across units. */
export type PinnedClaim = Omit<CodeClaim, 'id'>;

/** What a brief needs to pin a unit's claims to their source. */
export interface ClaimSource {
	inventory: ReviewInventory;
	model: ChangeModel | null;
	unit: ReviewUnit;
	/** The head commit, when the review has a checkout. */
	revision?: string;
}

/**
 * One unit's statements about its code. Drops those about files outside the
 * unit, lines the diff does not show, or filler, so a reviewer is never sent
 * to a place the brief invented. Keeps the first few per file in the model's
 * order, then pins each to the declaration around it (or its hunk) and the
 * head commit, so a reader can open the code the claim is about.
 */
export function unitClaims(raw: { text: string; file: string; line: number }[], source: ClaimSource): PinnedClaim[] {
	const { inventory, model, unit, revision } = source;
	const paths = new Set(unit.scope.map((entry) => entry.path));

	const valid = raw
		.map((claim) => ({ text: claim.text.trim(), file: claim.file.trim(), line: claim.line }))
		.filter((claim) => !isFiller(claim.text) && paths.has(claim.file) && inDiff(inventory, claim.file, claim.line));

	return acrossFiles(valid, MAX_CODE_CLAIMS).map((claim) => {
		const symbol = model ? symbolAt(model, claim.file, claim.line) : null;

		return {
			...claim,
			unit: unit.id,
			...(symbol && { symbol: symbol.qualifiedName }),
			range: symbol ? { start: symbol.startLine, end: symbol.endLine } : hunkRange(inventory, claim.file, claim.line),
			...(revision && { revision })
		};
	});
}

/**
 * Numbers every unit's claims, unit by unit in order and within a unit by
 * (file, line, text), so the same statements always get the same ids however
 * the model ordered them.
 */
export function numberClaims(byUnit: PinnedClaim[][], letter: string): CodeClaim[] {
	return byUnit
		.flatMap((claims) =>
			[...claims].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.text.localeCompare(b.text))
		)
		.map((claim, index) => ({ id: `${letter}${index + 1}`, ...claim }));
}

function claimLine(claim: CodeClaim): string {
	const at = claim.symbol ? ` (${claim.symbol})` : '';

	return `${claim.id} ${claim.file}:${claim.line}${at} ${claim.text}`;
}

/** Why the brief left a unit out, in words a reviewer reads. */
const OMITTED: Record<BriefOmission, string> = {
	size: 'its diff did not fit one call',
	time: 'the review ran out of time',
	budget: 'the model-call budget was spent',
	model: 'the model call failed'
};

/** A note for each unit around the scope that the brief did not read whole, so its silence is never taken for "nothing to say". */
function unreadNotes(intent: ChangeIntent, paths: Set<string>): string[] {
	const notes = (intent.units ?? [])
		.filter((unit) => unit.paths.some((path) => paths.has(path)))
		.flatMap((unit) => {
			if (unit.status === 'omitted') return [`The brief did not read this unit: ${OMITTED[unit.reason ?? 'model']}.`];
			if (unit.status === 'partial') return [`The brief read a clipped diff of this unit (${unit.detail}).`];

			return [];
		});

	return [...new Set(notes)];
}

/**
 * The part of the brief about one unit's files, for a reviewer: what the code
 * now does differently and, when `questions` is set, what to settle. It is a
 * model's reading, so it is headed as one; the verifier never sees it. A unit
 * the brief left out or clipped says so. Empty when the brief read the scope
 * whole and says nothing about it.
 */
export function briefBlock(intent: ChangeIntent | null, scope: UnitScope, questions: boolean): string {
	if (!intent) return '';

	const paths = new Set(scope.map((entry) => entry.path));
	const inScope = (claims: CodeClaim[]) => claims.filter((claim) => paths.has(claim.file));
	const observed = inScope(intent.observedChanges);
	const open = questions ? inScope(intent.openQuestions) : [];
	const notes = unreadNotes(intent, paths);

	if (!observed.length && !open.length) return notes.join('\n');

	const lines = [
		"Review brief for this unit (another model's reading of the diff, not established fact; confirm against the code before you rely on it):",
		...notes
	];

	if (observed.length) lines.push('What changed:', ...observed.map(claimLine));

	if (open.length) {
		lines.push(
			'Open questions (check each that falls in your lens; report a finding only where the code breaks it):',
			...open.map(claimLine)
		);
	}

	return lines.join('\n');
}
