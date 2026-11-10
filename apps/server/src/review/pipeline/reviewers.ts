import { REVIEW_POLICY, type ReviewLimits } from '../session/review-policy.js';
import type { InventoryFile, ReviewInventory } from './inventory.js';
import { isDocsPath, lensNames, lensesFor } from './lenses/lenses.js';
import type { Lens, LensId } from './lenses/types.js';
import { patchChars, patchLineChars, reviewableFiles, unitTitle, type ReviewUnit, type UnitScope } from './units.js';

/** One piece of the change a reviewer may take: a whole file, or one hunk of a file too large for one slice. */
interface Piece {
	path: string;
	hunkIds: string[];
	chars: number;
}

/** Patch characters in each hunk of a file, counted the way `patchChars` counts the whole file. */
function hunkSizes(inventory: ReviewInventory, file: InventoryFile): number[] {
	const diff = inventory.diffs.find((entry) => entry.path === file.path);

	return file.hunks.map((_, index) =>
		(diff?.hunks[index]?.lines ?? []).reduce((sum, line) => sum + patchLineChars(line), 0)
	);
}

/** Patch characters in the files a review reads. */
function reviewableChars(inventory: ReviewInventory, files: InventoryFile[]): number {
	return files.reduce((sum, file) => sum + patchChars(inventory, file), 0);
}

/**
 * How many reviewers read this change: the budget's count for a small change, its larger count when the
 * reviewable patch is over `REVIEW_POLICY.largeChangeChars`. A change of documentation only has one, since
 * only two lenses apply to it. It never exceeds the hunks there are to read.
 */
export function reviewerCount(inventory: ReviewInventory, limits: ReviewLimits): number {
	const files = reviewableFiles(inventory);
	const hunks = files.reduce((sum, file) => sum + file.hunks.length, 0);
	const large = reviewableChars(inventory, files) > REVIEW_POLICY.largeChangeChars;
	const wanted = large ? limits.reviewers.large : limits.reviewers.small;

	return files.length && files.every((file) => isDocsPath(file.path)) ? 1 : Math.min(wanted, hunks);
}

/**
 * The pieces in folder order: a file that fits one reviewer's share stays whole, and a larger one is cut into
 * its hunks, so a file is read by two reviewers only where it is too large for one.
 */
function pieces(inventory: ReviewInventory, files: InventoryFile[], share: number): Piece[] {
	return files.flatMap((file) => {
		const sizes = hunkSizes(inventory, file);
		const whole = sizes.reduce((sum, size) => sum + size, 0);

		if (whole <= share) return [{ path: file.path, hunkIds: file.hunks.map((hunk) => hunk.id), chars: whole }];

		return file.hunks.map((hunk, index) => ({ path: file.path, hunkIds: [hunk.id], chars: sizes[index] }));
	});
}

/** Adds a piece to a scope, joining the entry of the same file when the previous piece was one of its hunks. */
function addPiece(scope: UnitScope, piece: Piece): void {
	const last = scope[scope.length - 1];

	if (last?.path === piece.path) last.hunkIds.push(...piece.hunkIds);
	else scope.push({ path: piece.path, hunkIds: [...piece.hunkIds] });
}

/**
 * Cuts the change into at most `count` balanced scopes, in folder order, so every hunk is in exactly one. A cut
 * falls where the patch read so far passes its share of the whole, rounded to the nearer side, so no scope runs
 * far past its share and the last one is not left with the remainder.
 */
function balancedScopes(inventory: ReviewInventory, count: number): UnitScope[] {
	const files = reviewableFiles(inventory);
	const share = reviewableChars(inventory, files) / count;
	const scopes: UnitScope[] = [];
	let current: UnitScope = [];
	let read = 0;

	for (const piece of pieces(inventory, files, share)) {
		const cut = (scopes.length + 1) * share;

		if (current.length && scopes.length < count - 1 && read + piece.chars / 2 > cut) {
			scopes.push(current);
			current = [];
		}

		addPiece(current, piece);
		read += piece.chars;
	}

	if (current.length) scopes.push(current);

	return scopes;
}

/** A slice of the change with the lenses that apply to it, the review's lens selection counted. */
interface Slice {
	scope: UnitScope;
	lenses: Lens[];
}

/** The slices the change is cut into, one per reviewer the budget allows, each with its lenses. */
function cutSlices(inventory: ReviewInventory, limits: ReviewLimits, selection?: readonly LensId[]): Slice[] {
	const count = reviewerCount(inventory, limits);

	if (!count) return [];

	return balancedScopes(inventory, count).map((scope) => ({ scope, lenses: lensesFor(scope, selection) }));
}

/**
 * The reviewers of a change, cut without a model call so the same diff always gives the same reviewers in
 * the same order. Each reads one slice of it (`reviewer-1`…), so every changed hunk has exactly one reviewer,
 * and applies every lens that fits the slice: all of them, or the rules and readability lenses for a slice of
 * documentation only. With a lens selection it applies only the selected ones among them, and a slice none of
 * them fits has no reviewer (see `skippedSlices`).
 */
export function partitionReviewers(
	inventory: ReviewInventory,
	limits: ReviewLimits,
	selection?: readonly LensId[]
): ReviewUnit[] {
	return cutSlices(inventory, limits, selection)
		.filter((slice) => slice.lenses.length > 0)
		.map(({ scope, lenses }, index) => ({
			id: `reviewer-${index + 1}`,
			title: `Reviewer ${index + 1} · ${unitTitle(scope)}`,
			reason: `Reads every changed line in this slice and applies every lens that fits it: ${lensNames(lenses)}.`,
			scope,
			lenses: lenses.map((lens) => lens.id)
		}));
}

/** A slice of the change that no reviewer reads, and why. */
export interface SkippedSlice {
	scope: UnitScope;
	reason: string;
}

/**
 * The slices no selected lens fits, which `partitionReviewers` leaves without a reviewer. Only a lens selection
 * can leave one, so a review of every lens has none.
 */
export function skippedSlices(
	inventory: ReviewInventory,
	limits: ReviewLimits,
	selection?: readonly LensId[]
): SkippedSlice[] {
	if (!selection) return [];

	return cutSlices(inventory, limits, selection)
		.filter((slice) => slice.lenses.length === 0)
		.map(({ scope }) => ({
			scope,
			reason: `Not reviewed: this slice fits only these lenses (${lensNames(lensesFor(scope))}), and this review applies only ${selection.join(', ')}.`
		}));
}
