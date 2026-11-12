import { byCodePoint, type DiffLine, type ReviewAssignment } from '@recoder/shared';
import { REVIEW_POLICY } from '../session/review-policy.js';
import type { InventoryFile, ReviewInventory } from './inventory.js';
import type { LensId } from './lenses/types.js';

/** The hunks of one file a reviewer reads. */
export type UnitScope = { path: string; hunkIds: string[] }[];

/**
 * A slice of the change, cut from the inventory without a model call, so the
 * same diff always gives the same units in the same order. A brief unit
 * (`partitionUnits`) is summarized for the intent; a reviewer unit
 * (`partitionReviewers`) is read by one reviewer that applies every lens.
 */
export interface ReviewUnit {
	/**
	 * `unit-1`, `unit-2`… for a brief unit; `reviewer-1`… for a reviewer, whose retry is
	 * `retry-reviewer-1` (or `-a`/`-b` when split); `subagent-1` for a subagent.
	 */
	id: string;
	title: string;
	/** Why the unit runs; a retry carries how the first attempt failed. */
	reason: string;
	scope: UnitScope;
	/** The lenses a reviewer applies to its slice; unset on a brief unit and on a subagent. */
	lenses?: LensId[];
	/** Set on a subagent the harness sends for a second look rather than one a reviewer asked for. */
	purpose?: SecondLookPurpose;
}

/**
 * Why the harness sends a second-look subagent: `residual` looks for the
 * defects a unit's lenses missed, `contract-check` settles whether a comment
 * or the code it describes is wrong.
 */
export type SecondLookPurpose = 'residual' | 'contract-check';

const UNIT_REASON = 'Every changed line is read by every lens that applies to it.';

/** The id prefix of a reviewer's second attempt: `retry-reviewer-1`. */
const RETRY_PREFIX = 'retry-';

/** Patch characters in one diff line: its text, its sign and its line break. */
export function patchLineChars(line: DiffLine): number {
	return line.text.length + 2;
}

/** Patch characters in one file of the diff, counted the way the evidence store pages them. */
export function patchChars(inventory: ReviewInventory, file: Pick<InventoryFile, 'path'>): number {
	const diff = inventory.diffs.find((entry) => entry.path === file.path);

	return (diff?.hunks ?? []).reduce(
		(sum, hunk) => sum + hunk.lines.reduce((lines, line) => lines + patchLineChars(line), 0),
		0
	);
}

function directoryOf(path: string): string {
	const slash = path.lastIndexOf('/');

	return slash < 0 ? '.' : path.slice(0, slash);
}

/** "src/a.ts", "src/review", or "src/review and 2 more folders". */
export function unitTitle(scope: UnitScope): string {
	if (scope.length === 1) return scope[0].path;

	const folders = [...new Set(scope.map((entry) => directoryOf(entry.path)))];

	if (folders.length === 1) return `${folders[0]} (${scope.length} files)`;

	return `${folders[0]} and ${folders.length - 1} more folder${folders.length === 2 ? '' : 's'}`;
}

/** The files a review reads, in folder order: not excluded or summarized, and with a hunk to read. */
export function reviewableFiles(inventory: ReviewInventory): InventoryFile[] {
	return inventory.files
		.filter((file) => !file.excludeReason && !file.summarize && file.hunks.length > 0)
		.sort((a, b) => byCodePoint(directoryOf(a.path), directoryOf(b.path)) || byCodePoint(a.path, b.path));
}

/**
 * Splits the reviewable files into units of at most `budgetChars` patch
 * characters. Files stay whole and are packed in folder order, and a folder
 * that fits a unit of its own is never split across two. A file larger than
 * the budget is a unit by itself.
 */
export function partitionUnits(
	inventory: ReviewInventory,
	budgetChars: number = REVIEW_POLICY.unitBudgetChars
): ReviewUnit[] {
	const files = reviewableFiles(inventory);

	const folders = new Map<string, InventoryFile[]>();

	for (const file of files) folders.set(directoryOf(file.path), [...(folders.get(directoryOf(file.path)) ?? []), file]);

	const scopes: UnitScope[] = [];
	let current: UnitScope = [];
	let used = 0;

	const flush = () => {
		if (current.length) scopes.push(current);
		current = [];
		used = 0;
	};

	for (const folder of folders.values()) {
		const sizes = folder.map((file) => patchChars(inventory, file));
		const folderSize = sizes.reduce((sum, size) => sum + size, 0);

		if (used + folderSize > budgetChars && folderSize <= budgetChars) flush();

		for (const [index, file] of folder.entries()) {
			if (current.length && used + sizes[index] > budgetChars) flush();

			current.push({ path: file.path, hunkIds: file.hunks.map((hunk) => hunk.id) });
			used += sizes[index];
		}
	}

	flush();

	return scopes.map((scope, index) => ({
		id: `unit-${index + 1}`,
		title: unitTitle(scope),
		reason: UNIT_REASON,
		scope
	}));
}

/** The reviewers' own slices of `units`: a retry of a reviewer is not another slice. */
export function reviewerSlices(units: ReviewUnit[]): ReviewUnit[] {
	return units.filter((unit) => !isRetry(unit));
}

/** Whether the unit is the second attempt of a reviewer that failed. */
export function isRetry(unit: ReviewUnit): boolean {
	return unit.id.startsWith(RETRY_PREFIX);
}

/** The id of the unit a retry stands in for: `reviewer-1` for `retry-reviewer-1` and its halves `-a` and `-b`. */
export function originalUnitId(unitId: string): string {
	if (!unitId.startsWith(RETRY_PREFIX)) return unitId;

	return unitId.slice(RETRY_PREFIX.length).replace(/-[ab]$/, '');
}

/** A fresh, queued record for a reviewer or subagent. */
export function unitRecord(unit: ReviewUnit, role = 'reviewer'): ReviewAssignment {
	return {
		id: unit.id,
		role,
		title: unit.title,
		reason: unit.reason,
		status: 'queued',
		scope: unit.scope,
		candidateCount: 0,
		currentOperation: 'Queued',
		queuedAt: new Date().toISOString()
	};
}
