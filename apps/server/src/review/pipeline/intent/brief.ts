import { unitContext } from '../change-model/lookup.js';
import type { ChangeModel } from '../change-model/types.js';
import type { ReviewInventory } from '../inventory.js';
import type { UnitScope } from '../units.js';
import type { ChangeIntent, CodeClaim } from './types.js';

/** The diff a brief reads at most; a small model has to hold all of it at once. */
const MAX_DIFF_CHARS = 24_000;
const MAX_DECLARATION_CHARS = 8_000;
const MAX_CODE_CLAIMS = 12;

const SIGN = { add: '+', del: '-', context: ' ' } as const;

/** Paths the review reads; generated and excluded files tell a brief nothing. */
function reviewablePaths(inventory: ReviewInventory): string[] {
	return inventory.files.filter((file) => !file.excludeReason).map((file) => file.path);
}

/** One file's hunks with each new-side line numbered; a removed line has no number, so every cited line is on the new side. */
function fileDiff(inventory: ReviewInventory, path: string): string {
	const diff = inventory.diffs.find((entry) => entry.path === path);

	const hunks = (diff?.hunks ?? []).map((hunk) =>
		[hunk.header, ...hunk.lines.map((line) => `${SIGN[line.type]}${line.newNo ?? ''}| ${line.text}`)].join('\n')
	);

	return [`--- ${path}`, ...hunks].join('\n');
}

/** The reviewable files' diffs in inventory order, whole files only, up to the cap. */
function diffExcerpt(inventory: ReviewInventory): string {
	const paths = reviewablePaths(inventory);
	const shown: string[] = [];
	let used = 0;

	for (const path of paths) {
		const text = fileDiff(inventory, path);

		if (used + text.length > MAX_DIFF_CHARS && shown.length) break;

		shown.push(
			text.length > MAX_DIFF_CHARS ? `${text.slice(0, MAX_DIFF_CHARS)}\n…rest of this file's diff not shown` : text
		);

		used += text.length;
	}

	const omitted = paths.length - shown.length;

	return shown.join('\n\n') + (omitted ? `\n\n…${omitted} more changed file${omitted === 1 ? '' : 's'} not shown` : '');
}

/**
 * The code a brief is written from: the parser's changed declarations with
 * their references and tests, then the diff. Empty when nothing reviewable
 * changed. Same inventory and model, same text, so it can key a cache.
 */
export function codeInput(inventory: ReviewInventory, model: ChangeModel | null): string {
	const paths = reviewablePaths(inventory);

	if (!paths.length) return '';

	const scope = paths.map((path) => ({ path, hunkIds: [] }));
	const declarations = model ? unitContext(model, scope, MAX_DECLARATION_CHARS) : '';

	return [
		declarations,
		`Diff (new-side line numbers before each line; removed lines have none):\n${diffExcerpt(inventory)}`
	]
		.filter(Boolean)
		.join('\n\n');
}

/** Whether the line is one the diff shows on the new side of the file; any line counts in a file with none, a deleted one. */
function inDiff(inventory: ReviewInventory, path: string, line: number): boolean {
	const hunks = inventory.diffs.find((entry) => entry.path === path)?.hunks ?? [];
	const shown = hunks.flatMap((hunk) => hunk.lines.flatMap((entry) => entry.newNo ?? []));

	return !shown.length || shown.includes(line);
}

/**
 * Drops statements about files outside the review or lines the diff does not
 * show, so a reviewer is never sent to a place the brief invented, then numbers the rest in
 * (file, line, text) order, so the same statements always get the same ids
 * however the model ordered them.
 */
export function codeClaims(
	raw: { text: string; file: string; line: number }[],
	inventory: ReviewInventory,
	letter: string
): CodeClaim[] {
	const paths = new Set(reviewablePaths(inventory));

	return raw
		.map((claim) => ({ text: claim.text.trim(), file: claim.file.trim(), line: claim.line }))
		.filter((claim) => claim.text && paths.has(claim.file) && inDiff(inventory, claim.file, claim.line))
		.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.text.localeCompare(b.text))
		.slice(0, MAX_CODE_CLAIMS)
		.map((claim, index) => ({ id: `${letter}${index + 1}`, ...claim }));
}

function claimLine(claim: CodeClaim): string {
	return `${claim.id} ${claim.file}:${claim.line} ${claim.text}`;
}

/**
 * The part of the brief about one unit's files, for a reviewer: what the code
 * now does differently and, when `questions` is set, what to settle. It is a
 * model's reading, so it is headed as one; the verifier never sees it. Empty
 * when the brief says nothing about the scope.
 */
export function briefBlock(intent: ChangeIntent | null, scope: UnitScope, questions: boolean): string {
	if (!intent) return '';

	const paths = new Set(scope.map((entry) => entry.path));
	const inScope = (claims: CodeClaim[]) => claims.filter((claim) => paths.has(claim.file));
	const observed = inScope(intent.observedChanges);
	const open = questions ? inScope(intent.openQuestions) : [];

	if (!observed.length && !open.length) return '';

	const lines = [
		"Review brief for this unit (another model's reading of the diff, not established fact; confirm against the code before you rely on it):"
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
