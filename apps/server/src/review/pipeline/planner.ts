import { REVIEW_ROLES, type ReviewRole } from './roles.js';
import { DEFAULT_DISPATCH, type DispatchPolicy } from './dispatch.js';
import type { ReviewInventory } from './inventory.js';
import { coverageSweep, fallbackAssignment } from './planner/fallback.js';
import { normalizePlannerRaw } from './planner/normalize.js';
import {
	allowedRoles,
	plannerOutputSchema,
	ROLE_SET,
	type PlannerAssignment,
	type PlannerOutput,
	type PlanOptions
} from './planner/schema.js';

export { fallbackPlan } from './planner/fallback.js';
export { normalizePlannerRaw } from './planner/normalize.js';
export { plannerResponseSchema, plannerSystemPrompt, plannerUserPrompt } from './planner/prompts.js';
export type { PlannerAssignment, PlannerOutput, PlanOptions } from './planner/schema.js';

type Scope = PlannerAssignment['scope'];

export function plannerValidationError(raw: unknown): string {
	const parsed = plannerOutputSchema.safeParse(normalizePlannerRaw(raw));

	if (parsed.success) return 'Planner returned no usable assignments for the changed files';

	return (
		'Planner output validation failed: ' +
		parsed.error.issues
			.slice(0, 6)
			.map((issue) => `${issue.path.join('.') || 'plan'}: ${issue.message}`)
			.join('; ')
	);
}

/** Keeps the scope entries that name an eligible changed file, with hunk ids checked against it (all its hunks when none match). */
function scopeInInventory(
	scope: Scope,
	inventory: ReviewInventory,
	knownPaths: Map<string, ReviewInventory['files'][number]>
): Scope {
	return scope
		.map((entry) => {
			const file = knownPaths.get(entry.path);

			if (!file || file.excludeReason) return null;

			const validHunks = entry.hunkIds.filter(
				(id) => inventory.hunksById.has(id) && inventory.hunksById.get(id)?.file.path === file.path
			);

			const hunkIds = validHunks.length ? validHunks : file.hunks.map((hunk) => hunk.id);

			if (hunkIds.length === 0) return null;

			return { path: file.path, hunkIds };
		})
		.filter((entry): entry is { path: string; hunkIds: string[] } => entry !== null);
}

/**
 * Two specialists of one role reading the same hunks duplicate work: trims
 * the hunks an earlier same-role assignment already holds. When nothing is
 * left, the assignment's questions fold into that earlier one and this returns null.
 */
function disjointFromSameRole(
	assignment: PlannerAssignment,
	scope: Scope,
	accepted: PlannerAssignment[]
): Scope | null {
	const sameRole = accepted.filter((other) => other.role === assignment.role);
	const taken = new Set(sameRole.flatMap((other) => other.scope.flatMap((entry) => entry.hunkIds)));

	const fresh = scope
		.map((entry) => ({ ...entry, hunkIds: entry.hunkIds.filter((id) => !taken.has(id)) }))
		.filter((entry) => entry.hunkIds.length > 0);

	if (fresh.length) return fresh;

	const ids = new Set(scope.flatMap((entry) => entry.hunkIds));
	const host = sameRole.find((other) => other.scope.some((entry) => entry.hunkIds.some((id) => ids.has(id))));

	if (host) host.questions = [...new Set([...host.questions, ...assignment.questions])].slice(0, 12);

	return null;
}

/** A role the planner marked "selected" must actually run, even when it forgot to write the assignment for it. */
function addSelectedRoles(
	assignments: PlannerAssignment[],
	decisions: PlannerOutput['roleDecisions'],
	inventory: ReviewInventory,
	allowed: ReadonlySet<ReviewRole>,
	limit: number
): void {
	const assigned = new Set(assignments.map((assignment) => assignment.role));

	for (const decision of decisions) {
		if (
			decision.decision !== 'selected' ||
			assigned.has(decision.role) ||
			!allowed.has(decision.role) ||
			assignments.length >= limit
		)
			continue;

		const extra = fallbackAssignment(`${decision.role}-selected`, decision.role, inventory, 50);

		if (extra.scope.length === 0) continue;

		assignments.push({ ...extra, reason: decision.reason });
		assigned.add(decision.role);
	}
}

/** One decision per role, matching what was actually assigned. */
function settledRoleDecisions(
	assignments: PlannerAssignment[],
	provided: PlannerOutput['roleDecisions'],
	allowed: ReadonlySet<ReviewRole>
): PlannerOutput['roleDecisions'] {
	const selected = new Set(assignments.map((assignment) => assignment.role));

	return REVIEW_ROLES.map((role) => {
		const given = provided.find((decision) => decision.role === role);

		if (selected.has(role)) {
			return { role, decision: 'selected' as const, reason: given?.reason ?? 'Assigned during planning' };
		}

		if (!allowed.has(role)) return { role, decision: 'not_needed' as const, reason: 'Left out by your instructions' };

		return given ?? { role, decision: 'not_needed' as const, reason: 'Not selected for this change set' };
	});
}

export function sanitizePlannerOutput(
	raw: unknown,
	inventory: ReviewInventory,
	options: PlanOptions = {}
): PlannerOutput | null {
	const parsed = plannerOutputSchema.safeParse(normalizePlannerRaw(raw));

	if (!parsed.success) return null;

	const followUp = options.followUp ?? false;
	const dispatch = options.dispatch ?? DEFAULT_DISPATCH;
	const allowed = allowedRoles(options.directive);
	const knownPaths = new Map(inventory.files.map((file) => [file.path, file]));
	const usedIds = new Set<string>();
	const assignments: PlannerAssignment[] = [];

	for (const assignment of parsed.data.assignments) {
		if (ROLE_SET.has(assignment.id)) continue;
		if (usedIds.has(assignment.id)) continue;
		if (!allowed.has(assignment.role)) continue;

		let scope: Scope | null = scopeInInventory(assignment.scope, inventory, knownPaths);

		if (scope.length === 0) continue;
		if (!followUp) scope = disjointFromSameRole(assignment, scope, assignments);
		if (!scope) continue;

		usedIds.add(assignment.id);
		assignments.push({ ...assignment, scope });
	}

	const limit = options.maxAssignments ?? (followUp ? dispatch.maxFollowUpAssignments : dispatch.maxInitialAssignments);
	let clipped = assignments.sort((a, b) => a.priority - b.priority).slice(0, limit);

	if (!followUp && inventory.executable) {
		clipped = ensureMandatory(clipped, inventory, dispatch, allowed);
	}

	if (!followUp) addSelectedRoles(clipped, parsed.data.roleDecisions, inventory, allowed, limit);
	if (clipped.length === 0) return null;
	if (!followUp) clipped.push(...coverageSweep(clipped, inventory, dispatch, allowed));

	return {
		summary: parsed.data.summary,
		assignments: clipped,
		roleDecisions: settledRoleDecisions(clipped, parsed.data.roleDecisions, allowed),
		checks: parsed.data.checks ?? []
	};
}

function ensureMandatory(
	assignments: PlannerAssignment[],
	inventory: ReviewInventory,
	dispatch: DispatchPolicy,
	allowed: ReadonlySet<ReviewRole>
): PlannerAssignment[] {
	const have = new Set(assignments.map((assignment) => assignment.role));
	const required = dispatch.mandatoryRoles.filter((role) => allowed.has(role));

	const extra: PlannerAssignment[] = required
		.filter((role) => !have.has(role))
		.map((role, index) => fallbackAssignment(`${role}-core`, role, inventory, index + 1))
		.filter((assignment) => assignment.scope.length > 0);

	const merged = [...extra, ...assignments];
	const seen = new Set<string>();
	const unique: PlannerAssignment[] = [];

	for (const assignment of merged) {
		if (seen.has(assignment.id)) continue;
		seen.add(assignment.id);
		unique.push(assignment);
	}

	const isMandatory = (assignment: PlannerAssignment) => required.includes(assignment.role);

	return [...unique.filter(isMandatory), ...unique.filter((assignment) => !isMandatory(assignment))].slice(
		0,
		Math.max(dispatch.maxInitialAssignments, required.length)
	);
}

export function isAuthFailure(err: unknown): boolean {
	const status =
		typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status: number }).status) : 0;

	if (status === 401 || status === 403) return true;

	const message = err instanceof Error ? err.message : String(err);

	return /\b401\b|\b403\b|unauthorized|forbidden|invalid api key|invalid token/i.test(message);
}
