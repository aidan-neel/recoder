import type { ReviewInventory } from './inventory.js';
import type { SubagentRequest } from './reviewer.js';
import type { ReviewUnit, UnitScope } from './units.js';

/** A subagent a unit's reviewer asked for. */
export interface UnitRequest {
	unitId: string;
	unitTitle: string;
	request: SubagentRequest;
}

/**
 * The subagent stage as it stands, saved with the checkpoint. `units` is null
 * until the stage is planned, so a resumed review plans it only once.
 */
export interface SubagentState {
	requests: UnitRequest[];
	units: ReviewUnit[] | null;
	/** Requests past the cap, reported in the summary. */
	dropped: UnitRequest[];
}

export function emptySubagentState(): SubagentState {
	return { requests: [], units: null, dropped: [] };
}

/**
 * The requested scope, cut down to hunks the review covers: files outside the
 * review (excluded, summarized, or outside the developer's instructions) and
 * unknown hunks are dropped, and a file named without hunks means all of them.
 * Falls back to the requesting unit's scope when nothing is left.
 */
function reviewableScope(request: SubagentRequest, inventory: ReviewInventory, fallback: UnitScope): UnitScope {
	const scope = request.scope.flatMap((entry) => {
		const file = inventory.files.find((candidate) => candidate.path === entry.path);

		if (!file || file.excludeReason || file.summarize || !file.hunks.length) return [];

		const known = file.hunks.map((hunk) => hunk.id);
		const hunkIds = entry.hunkIds.filter((hunkId) => known.includes(hunkId));

		return [{ path: file.path, hunkIds: hunkIds.length ? hunkIds : known }];
	});

	return scope.length ? scope : fallback;
}

function sameConcern(a: string, b: string): boolean {
	return a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');
}

function overlaps(a: UnitScope, b: UnitScope): boolean {
	const hunks = new Set(a.flatMap((entry) => entry.hunkIds));

	return b.some((entry) => entry.hunkIds.some((hunkId) => hunks.has(hunkId)));
}

/**
 * Picks the subagents to run from every reviewer's requests, without a model:
 * requests go in unit order, one with the same concern as an earlier request
 * over overlapping hunks is merged into it, and the rest run up to `cap`. The
 * requests past the cap are returned as dropped; at cap 0 there are none to
 * report, since reviewers aren't offered subagents.
 */
export function planSubagents(
	requests: UnitRequest[],
	units: ReviewUnit[],
	inventory: ReviewInventory,
	cap: number
): { units: ReviewUnit[]; dropped: UnitRequest[] } {
	if (cap <= 0) return { units: [], dropped: [] };

	const order = (unitId: string) => units.findIndex((unit) => unit.id === unitId);
	const ordered = requests.map((entry, index) => ({ entry, index }));

	ordered.sort((a, b) => order(a.entry.unitId) - order(b.entry.unitId) || a.index - b.index);

	const unique: { entry: UnitRequest; scope: UnitScope }[] = [];

	for (const { entry } of ordered) {
		const fallback = units.find((unit) => unit.id === entry.unitId)?.scope ?? [];
		const scope = reviewableScope(entry.request, inventory, fallback);

		const duplicate = unique.some(
			(kept) => sameConcern(kept.entry.request.concern, entry.request.concern) && overlaps(kept.scope, scope)
		);

		if (!duplicate && scope.length) unique.push({ entry, scope });
	}

	return {
		units: unique.slice(0, cap).map(({ entry, scope }, index) => ({
			id: `subagent-${index + 1}`,
			title: entry.request.concern,
			reason: `Asked by the reviewer of ${entry.unitTitle}: ${entry.request.question}\nWhy: ${entry.request.why}`,
			scope
		})),
		dropped: unique.slice(cap).map(({ entry }) => entry)
	};
}
