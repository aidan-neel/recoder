import { originalUnitId, type ReviewUnit } from '../units.js';

/** The id prefix of the second pass's reviewers: `independent-reviewer-1`. */
const INDEPENDENT_PREFIX = 'independent-';

/** Whether the unit is a reviewer of the independent pass, or a retry of one. */
export function isIndependentReviewer(unitId: string): boolean {
	return originalUnitId(unitId).startsWith(INDEPENDENT_PREFIX);
}

/**
 * A second, complete review of the change: one reviewer per slice of the first pass, over the same hunks with the
 * same lenses. It runs in the same pool as the first pass, and no reviewer's prompt holds another reviewer's
 * findings, nor the discussion that relays them (`developerDiscussion`), so it never sees what the first pass reported. Consolidation merges what both passes report, and a
 * finding only one of them raised is still published once verified.
 */
export function independentPassUnits(slices: ReviewUnit[]): ReviewUnit[] {
	return slices.map((slice) => ({
		...slice,
		id: `${INDEPENDENT_PREFIX}${slice.id}`,
		title: `Independent pass · ${slice.title}`,
		reason: `A second review of this slice that never sees the first pass's findings. ${slice.reason}`,
		scope: slice.scope.map((entry) => ({ path: entry.path, hunkIds: [...entry.hunkIds] })),
		...(slice.lenses ? { lenses: [...slice.lenses] } : {})
	}));
}
