import type { ReviewInventory } from '../inventory.js';
import { planSubagents, type UnitRequest } from '../subagents.js';
import { originalUnitId, type ReviewUnit } from '../units.js';
import { isSpecialistTree } from './specialist-plan.js';

/** Child investigators (subagents) one specialist of the tree may send (issue #95). */
export const SPECIALIST_CHILDREN = 3;

/**
 * The subagents the reviewers' requests plan, up to `cap` (`planSubagents`). In a specialist tree each specialist
 * keeps only its first `SPECIALIST_CHILDREN` requests, most important first as it ranked them, and the rest are
 * dropped with those over the cap; the requests of its retries count as its own, so a specialist split in two halves
 * still sends no more. Without a tree every request is planned as before.
 */
export function planRequestedSubagents(
	requests: UnitRequest[],
	units: ReviewUnit[],
	inventory: ReviewInventory,
	cap: number
): { units: ReviewUnit[]; dropped: UnitRequest[] } {
	const overLimit = isSpecialistTree(units)
		? requests.filter((_, index) => rankOf(requests, index) >= SPECIALIST_CHILDREN)
		: [];

	const plan = planSubagents(
		requests.filter((entry) => !overLimit.includes(entry)),
		units,
		inventory,
		cap
	);

	return { units: plan.units, dropped: [...overLimit, ...plan.dropped] };
}

/** How many requests the same specialist, or a retry of it, made before the one at `index`. */
function rankOf(requests: UnitRequest[], index: number): number {
	const specialist = originalUnitId(requests[index].unitId);

	return requests.slice(0, index).filter((entry) => originalUnitId(entry.unitId) === specialist).length;
}
