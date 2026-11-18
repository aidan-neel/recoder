import { lensById, lensNames } from '../lenses/lenses.js';
import type { LensId } from '../lenses/types.js';
import type { ReviewUnit } from '../units.js';

/** The id prefix of a lens-split reviewer: `lens-security-reviewer-1`. */
const LENS_SPLIT_PREFIX = 'lens-';

/**
 * The reviewers one slice is split into. Each defect lens asks its own kind of question, so each gets a reviewer
 * of its own and a procedure it can hold in mind; the three maintainability lenses share one, since they report
 * what the repository proves and none of them reasons about behavior.
 */
const LENS_GROUPS: readonly { name: string; lenses: readonly LensId[] }[] = [
	{ name: 'correctness', lenses: ['correctness'] },
	{ name: 'api-contract', lenses: ['api-contract'] },
	{ name: 'security', lenses: ['security'] },
	{ name: 'concurrency', lenses: ['concurrency'] },
	{ name: 'performance', lenses: ['performance'] },
	{ name: 'upkeep', lenses: ['rules', 'conventions', 'readability'] }
];

/** Whether the review's units are lens-split reviewers already. */
export function isLensSplit(units: ReviewUnit[]): boolean {
	return units.some((unit) => unit.id.startsWith(LENS_SPLIT_PREFIX));
}

/**
 * One reviewer per lens group for every slice, in place of the slice's one reviewer of every lens. It is cut
 * without a model call, so the same change always gives the same reviewers, and every lens that fitted a slice
 * still reads all of it: only who applies it changes. A group none of whose lenses fits a slice has no reviewer.
 */
export function lensSplitUnits(slices: ReviewUnit[]): ReviewUnit[] {
	return slices.flatMap((slice) =>
		LENS_GROUPS.flatMap((group) => {
			const lenses = group.lenses.filter((lens) => slice.lenses?.includes(lens));

			if (!lenses.length) return [];

			const names = lensNames(lenses.map(lensById));

			return [
				{
					...slice,
					id: `${LENS_SPLIT_PREFIX}${group.name}-${slice.id}`,
					title: `${names} · ${slice.title}`,
					reason: `Reads every changed line in this slice and applies only: ${names}.`,
					scope: slice.scope.map((entry) => ({ path: entry.path, hunkIds: [...entry.hunkIds] })),
					lenses
				}
			];
		})
	);
}
