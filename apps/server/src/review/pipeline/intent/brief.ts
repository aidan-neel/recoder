import type { DiffLine } from '@recoder/shared';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import { symbolAt, unitContext } from '../change-model/lookup.js';
import type { ChangeModel } from '../change-model/types.js';
import type { ReviewInventory } from '../inventory.js';
import { patchChars, patchLineChars, type ReviewUnit, type UnitScope } from '../units.js';
import type { BriefOmission, ChangeIntent, CodeClaim } from './types.js';

const MAX_DECLARATION_CHARS = 8_000;

/** Per unit and list. A reviewer is shown only its own unit's claims, so this is what one reviewer reads at most. */
const MAX_CODE_CLAIMS = 12;

const SIGN = { add: '+', del: '-', context: ' ' } as const;

/** Whether the change deleted the file, so it has only an old side to cite. */
function isDeleted(inventory: ReviewInventory, path: string): boolean {
	return inventory.files.find((file) => file.path === path)?.status === 'deleted';
}

/** A line's number on the side its file still has: the new side, or the old side of a deleted file. */
const lineNo = (line: DiffLine, deleted: boolean) => (deleted ? line.oldNo : line.newNo);

/** A diff line with the number a claim cites; a removed line of a kept file has none. */
const numbered = (line: DiffLine, deleted: boolean) => `${SIGN[line.type]}${lineNo(line, deleted) ?? ''}| ${line.text}`;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The first lines of a hunk that fit in `chars`. */
function linesWithin(lines: DiffLine[], chars: number): DiffLine[] {
	let left = chars;
	let count = 0;

	while (count < lines.length && patchLineChars(lines[count]) <= left) left -= patchLineChars(lines[count++]);

	return lines.slice(0, count);
}

/** A file whose diff did not fit its share of one call, with how many of its lines were shown. */
export interface ClippedFile {
	path: string;
	shown: number;
	total: number;
}

/**
 * One file's diff within `share` patch characters, measured as the partition
 * measures them, so a unit `partitionUnits` sized to fit is never clipped;
 * the line numbers and headers are headroom outside the count. Whole hunks
 * are kept in order while they fit and a hunk that does not is named by its
 * header only; when no hunk fits, the first is cut at a line.
 */
function fileDiff(inventory: ReviewInventory, path: string, share: number): { text: string; clipped?: ClippedFile } {
	const hunks = inventory.diffs.find((entry) => entry.path === path)?.hunks ?? [];
	const deleted = isDeleted(inventory, path);
	const size = (lines: DiffLine[]) => lines.reduce((sum, line) => sum + patchLineChars(line), 0);
	const anyFits = hunks.some((hunk) => size(hunk.lines) <= share);
	let left = share;

	const kept = hunks.map((hunk, index) => {
		const lines = size(hunk.lines) <= left ? hunk.lines : !anyFits && index === 0 ? linesWithin(hunk.lines, left) : [];

		left -= size(lines);

		return lines;
	});

	const total = hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
	const shown = kept.reduce((sum, lines) => sum + lines.length, 0);

	const text = hunks.map((hunk, index) => {
		const rest = hunk.lines.length - kept[index].length;
		const note = rest ? [`…${plural(rest, 'more line')} of this hunk not shown`] : [];

		return [hunk.header, ...kept[index].map((line) => numbered(line, deleted)), ...note].join('\n');
	});

	return { text: [`--- ${path}`, ...text].join('\n'), ...(shown < total && { clipped: { path, shown, total } }) };
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

/**
 * What one unit's summary is written from: the parser's changed declarations
 * with their references and tests, then every file's diff. The diff gets the
 * partition's own budget, so only a file larger than a whole unit is clipped,
 * and then to its share, so it never hides the others. Same inventory, model
 * and unit, same text, so it can key a cache.
 */
export function unitInput(
	inventory: ReviewInventory,
	model: ChangeModel | null,
	scope: UnitScope
): { text: string; clipped: ClippedFile[] } {
	const limits = shares(
		scope.map((entry) => patchChars(inventory, entry)),
		REVIEW_POLICY.unitBudgetChars
	);

	const diffs = scope.map((entry, index) => fileDiff(inventory, entry.path, limits[index]));
	const declarations = model ? unitContext(model, scope, MAX_DECLARATION_CHARS) : '';

	const diff = `Diff (new-side line numbers before each line, and removed lines have none; a deleted file's lines have their old numbers):\n${diffs.map((entry) => entry.text).join('\n\n')}`;

	return {
		text: [declarations, diff].filter(Boolean).join('\n\n'),
		clipped: diffs.flatMap((entry) => entry.clipped ?? [])
	};
}

/** Text a model copied from the reply template or left as filler: `...`, `…`, `N/A`, or nothing. */
export function isFiller(text: string): boolean {
	return /^[\s.…\-–—_?]*$/.test(text) || /^(n\/a|none|todo|tbd)$/i.test(text.trim());
}

/** Whether the diff shows the line on the side its file still has. */
function inDiff(inventory: ReviewInventory, path: string, line: number): boolean {
	const deleted = isDeleted(inventory, path);
	const hunks = inventory.diffs.find((entry) => entry.path === path)?.hunks ?? [];

	return hunks.some((hunk) => hunk.lines.some((entry) => lineNo(entry, deleted) === line));
}

/** The hunk that shows `line`, on the side its file still has, or the line alone when none does. */
function hunkRange(inventory: ReviewInventory, path: string, line: number): { start: number; end: number } {
	const deleted = isDeleted(inventory, path);

	const span = inventory.diffs
		.find((entry) => entry.path === path)
		?.hunks.map((hunk) => (deleted ? [hunk.oldStart, hunk.oldCount] : [hunk.newStart, hunk.newCount]))
		.find(([start, count]) => count && start <= line && line < start + count);

	return span ? { start: span[0], end: span[0] + span[1] - 1 } : { start: line, end: line };
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
	/** The merge base, which a deleted file's lines are on; unset without a checkout. */
	base?: string;
}

/**
 * Where a claim's line is: the declaration around it (or its hunk) at the
 * head commit, or for a deleted file its old hunk at the merge base, left
 * unpinned when the review has no merge base to name.
 */
function pinOf(source: ClaimSource, file: string, line: number): Pick<PinnedClaim, 'symbol' | 'range' | 'revision'> {
	const { inventory, model, revision, base } = source;

	if (isDeleted(inventory, file)) return base ? { range: hunkRange(inventory, file, line), revision: base } : {};

	const symbol = model ? symbolAt(model, file, line) : null;

	return {
		...(symbol && { symbol: symbol.qualifiedName }),
		range: symbol ? { start: symbol.startLine, end: symbol.endLine } : hunkRange(inventory, file, line),
		...(revision && { revision })
	};
}

/**
 * One unit's statements about its code. Drops those about files outside the
 * unit, lines the diff does not show, or filler, so a reviewer is never sent
 * to a place the brief invented. Keeps the first few per file in the model's
 * order, then pins each to where its line is, so a reader can open the code
 * the claim is about.
 */
export function unitClaims(raw: { text: string; file: string; line: number }[], source: ClaimSource): PinnedClaim[] {
	const { inventory, unit } = source;
	const paths = new Set(unit.scope.map((entry) => entry.path));

	const valid = raw
		.map((claim) => ({ text: claim.text.trim(), file: claim.file.trim(), line: claim.line }))
		.filter((claim) => !isFiller(claim.text) && paths.has(claim.file) && inDiff(inventory, claim.file, claim.line));

	return acrossFiles(valid, MAX_CODE_CLAIMS).map((claim) => ({
		...claim,
		unit: unit.id,
		...pinOf(source, claim.file, claim.line)
	}));
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
