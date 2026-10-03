import { REVIEW_ROLES, ROLE_LABELS, type ReviewRole } from '../roles.js';
import { DEFAULT_DISPATCH, type DispatchPolicy } from '../dispatch.js';
import {
	eligibleFiles,
	rankFiles,
	type InventoryFile,
	type InventoryHunk,
	type ReviewInventory
} from '../inventory.js';
import { allowedRoles, type PlannerAssignment, type PlannerOutput, type PlanOptions } from './schema.js';

/**
 * A plan built without the model: bounded package-local scopes that the
 * mandatory roles inspect as far as the specialist budget goes, with the rest
 * swept for correctness.
 */
export function fallbackPlan(
	inventory: ReviewInventory,
	reason = 'Planner output was invalid; using bounded fallback assignments.',
	options: Pick<PlanOptions, 'dispatch' | 'directive'> = {}
): PlannerOutput {
	const dispatch = options.dispatch ?? DEFAULT_DISPATCH;
	const allowed = allowedRoles(options.directive);

	if (inventory.docsOnly) {
		const role = allowed.has('docs') ? 'docs' : ([...allowed][0] ?? 'docs');
		const assignment = fallbackAssignment('docs-core', role, inventory, 1);

		return {
			summary: reason,
			assignments: assignment.scope.length ? [assignment] : [],
			roleDecisions: roleDecisionsFor([role], 'Documentation-only change set')
		};
	}

	const roles = dispatch.mandatoryRoles.filter((role) => allowed.has(role));

	if (roles.length === 0) roles.push(allowed.has('correctness') ? 'correctness' : ([...allowed][0] ?? 'correctness'));

	const groups = groupHunks(rankFiles(eligibleFiles(inventory)), inventory);
	const perGroup = Math.max(1, Math.floor(dispatch.maxInitialAssignments / roles.length));

	const fallback = groups
		.slice(0, perGroup)
		.flatMap((scope, index) =>
			roles.map((role, roleIndex) => ({
				...fallbackAssignment(
					`${role}-core${index ? `-${index + 1}` : ''}`,
					role,
					inventory,
					index * roles.length + roleIndex + 1
				),
				scope,
				title: `${ROLE_LABELS[role]}: ${scope[0].path}${scope.length > 1 ? ` and ${scope.length - 1} related files` : ''}`,
				reason: 'Bounded fallback scope after planning failed.'
			}))
		)
		.slice(0, dispatch.maxInitialAssignments);

	const assignments = [...fallback, ...coverageSweep(fallback, inventory, dispatch, allowed)];

	return {
		summary: reason,
		assignments,
		roleDecisions: roleDecisionsFor(
			assignments.map((assignment) => assignment.role),
			'Fallback after invalid or incomplete planning'
		)
	};
}

interface GroupLimits {
	chars: number;
	hunks: number;
	files: number;
	/** Start a new group at each package boundary. */
	byPackage: boolean;
}

/** One specialist can read a whole group: ~24k patch characters, 40 hunks, 8 files, one package. */
const ASSIGNMENT_GROUP: GroupLimits = { chars: 24_000, hunks: 40, files: 8, byPackage: true };
/** Sweeps cover more ground each, across packages, and page through their patch. */
const SWEEP_GROUP: GroupLimits = { chars: 48_000, hunks: 80, files: 16, byPackage: false };
/** When the sweep cap would leave code unread, each sweep takes up to twice as much. */
const WIDE_SWEEP_GROUP: GroupLimits = { chars: 96_000, hunks: 160, files: 32, byPackage: false };

function groupHunks(
	files: InventoryFile[],
	inventory: ReviewInventory,
	include: (hunk: InventoryHunk) => boolean = () => true,
	limits: GroupLimits = ASSIGNMENT_GROUP
): PlannerAssignment['scope'][] {
	const groups: PlannerAssignment['scope'][] = [];
	let group: PlannerAssignment['scope'] = [];
	let chars = 0;
	let hunks = 0;
	let boundary: string | null = null;

	for (const file of files) {
		const diff = inventory.diffs.find((entry) => entry.path === file.path);

		for (const hunk of file.hunks) {
			if (!include(hunk)) continue;

			const size =
				diff?.hunks
					.find((entry) => entry.header === hunk.header)
					?.lines.reduce((sum, line) => sum + line.text.length + 2, 0) ?? 0;

			if (
				group.length &&
				(chars + size > limits.chars ||
					hunks >= limits.hunks ||
					group.length >= limits.files ||
					(limits.byPackage && boundary !== file.packageId))
			) {
				groups.push(group);
				group = [];
				chars = 0;
				hunks = 0;
			}

			boundary = file.packageId;

			let scope = group.find((entry) => entry.path === file.path);

			if (!scope) {
				scope = { path: file.path, hunkIds: [] };
				group.push(scope);
			}

			scope.hunkIds.push(hunk.id);
			chars += size;
			hunks++;
		}
	}

	if (group.length) groups.push(group);

	return groups;
}

/**
 * Correctness assignments over the code hunks no correctness assignment covers,
 * as many as the dispatch level leaves room for. Code beyond that stays
 * unassigned and is reported as a coverage gap. Docs and summarized files
 * (lockfiles) are left out, as is everything when the developer's
 * instructions don't include the correctness lens.
 */
export function coverageSweep(
	assignments: PlannerAssignment[],
	inventory: ReviewInventory,
	dispatch: DispatchPolicy = DEFAULT_DISPATCH,
	allowed: ReadonlySet<ReviewRole> = new Set(REVIEW_ROLES)
): PlannerAssignment[] {
	if (!allowed.has('correctness')) return [];

	const room = Math.min(dispatch.maxSweepAssignments, dispatch.maxSpecialists - assignments.length);

	if (room <= 0) return [];

	const covered = new Set(
		assignments
			.filter((assignment) => assignment.role === 'correctness')
			.flatMap((assignment) => assignment.scope.flatMap((entry) => entry.hunkIds))
	);

	const files = rankFiles(eligibleFiles(inventory).filter((file) => file.classification !== 'docs' && !file.summarize));
	const ids = new Set(assignments.map((assignment) => assignment.id));
	const uncovered = (hunk: InventoryHunk) => !covered.has(hunk.id);
	let groups = groupHunks(files, inventory, uncovered, SWEEP_GROUP);

	if (groups.length > room) groups = groupHunks(files, inventory, uncovered, WIDE_SWEEP_GROUP);

	return groups.slice(0, room).map((scope, index) => {
		let id = `sweep-${index + 1}`;

		while (ids.has(id)) id = `${id}x`;

		return {
			id,
			role: 'correctness' as const,
			title: `Correctness sweep: ${scope[0].path}${scope.length > 1 ? ` and ${scope.length - 1} related file${scope.length > 2 ? 's' : ''}` : ''}`,
			reason: 'No planned correctness assignment covered these changes; swept so every changed code hunk is read.',
			scope,
			questions: [
				'What behavioral regressions or broken invariants does this introduce?',
				'Do the callers and consumers of this code still work with it?'
			],
			contextEvidenceIds: [],
			priority: 100 + index
		};
	});
}

export function fallbackAssignment(
	id: string,
	role: ReviewRole,
	inventory: ReviewInventory,
	priority: number
): PlannerAssignment {
	const pool = rankFiles(
		eligibleFiles(inventory).filter((file) =>
			role === 'docs' ? file.classification === 'docs' : file.classification !== 'docs'
		)
	).slice(0, 12);

	const scope = (pool.length ? pool : rankFiles(eligibleFiles(inventory)).slice(0, 12)).map((file) => ({
		path: file.path,
		hunkIds: file.hunks.map((hunk) => hunk.id)
	}));

	return {
		id,
		role,
		title: role === 'patterns' ? 'Repository consistency of primary changes' : `${role} of primary changes`,
		reason: 'Deterministic fallback over the highest-churn eligible files.',
		scope,
		questions:
			role === 'patterns'
				? [
						'Does this match existing repository conventions?',
						'Are there already helpers or patterns this should reuse?'
					]
				: ['What behavioral regressions or broken invariants does this introduce?'],
		contextEvidenceIds: [],
		priority
	};
}

function roleDecisionsFor(selected: ReviewRole[], reason: string): PlannerOutput['roleDecisions'] {
	const set = new Set(selected);

	return REVIEW_ROLES.map((role) => ({
		role,
		decision: set.has(role) ? ('selected' as const) : ('not_needed' as const),
		reason: set.has(role) ? reason : 'Not selected in fallback plan'
	}));
}
