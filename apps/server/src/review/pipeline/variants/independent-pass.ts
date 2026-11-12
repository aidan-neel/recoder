import type { ReviewUnit } from '../units.js';

/** The id prefix of the second pass's reviewers: `independent-reviewer-1`. */
export const INDEPENDENT_PREFIX = 'independent-';

/**
 * A second, complete review of the change: one reviewer per slice of the first pass, over the same hunks with the
 * same lenses. It runs in the same pool as the first pass, and no reviewer's prompt holds another reviewer's
 * findings, so it never sees what the first pass reported. Consolidation merges what both passes report, and a
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
