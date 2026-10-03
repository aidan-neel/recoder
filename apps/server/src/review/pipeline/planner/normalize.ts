import { ROLE_LABELS, resolveRole } from '../roles.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import { clip } from '../schemas.js';
import { MAX_RAW_ASSIGNMENTS, ROLE_SET } from './schema.js';

const DECISION_ALIASES: Record<string, 'selected' | 'not_needed' | 'deferred'> = {
	selected: 'selected',
	select: 'selected',
	yes: 'selected',
	run: 'selected',
	include: 'selected',
	included: 'selected',
	needed: 'selected',
	assign: 'selected',
	assigned: 'selected',
	true: 'selected',
	not_needed: 'not_needed',
	no: 'not_needed',
	skip: 'not_needed',
	skipped: 'not_needed',
	none: 'not_needed',
	unneeded: 'not_needed',
	false: 'not_needed',
	exclude: 'not_needed',
	excluded: 'not_needed',
	omit: 'not_needed',
	omitted: 'not_needed',
	not_selected: 'not_needed',
	unnecessary: 'not_needed',
	deferred: 'deferred',
	defer: 'deferred',
	later: 'deferred',
	maybe: 'deferred'
};

/** A string or list of strings as at most `max` trimmed, non-empty strings of at most `each` characters. */
function strings(value: unknown, max: number, each: number): string[] {
	const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];

	return list
		.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
		.map((item) => clip(item.trim(), each) as string)
		.slice(0, max);
}

/** A scope given as a path, a list of paths, one entry or a list of entries, as `{ path, hunkIds }` entries. */
function normalizeScope(rawScope: unknown): { path: string; hunkIds: string[] }[] {
	const list =
		typeof rawScope === 'string'
			? [rawScope]
			: Array.isArray(rawScope)
				? rawScope
				: rawScope && typeof rawScope === 'object'
					? [rawScope]
					: [];

	return list
		.flatMap((entry) => {
			if (typeof entry === 'string') return entry.trim() ? [{ path: entry.trim(), hunkIds: [] }] : [];
			if (!entry || typeof entry !== 'object') return [];

			const e = entry as Record<string, unknown>;

			const path = [e.path, e.file, e.filePath, e.file_path].find((value) => typeof value === 'string') as
				string | undefined;

			if (!path?.trim()) return [];

			return [{ path: path.trim(), hunkIds: strings(e.hunkIds ?? e.hunks, 80, 300) }];
		})
		.slice(0, 40);
}

/** Repairs one assignment, or drops it when it has no recognizable role. */
function normalizeAssignment(item: unknown, index: number): Record<string, unknown>[] {
	if (!item || typeof item !== 'object' || Array.isArray(item)) return [];

	const a = { ...(item as Record<string, unknown>) };

	const roleText = [a.role, a.lens, a.specialist, a.agent].find((value) => typeof value === 'string') as
		string | undefined;

	const role = roleText ? resolveRole(roleText) : null;

	if (!role) return [];

	a.role = role;
	a.scope = normalizeScope(a.scope ?? a.files ?? a.paths ?? a.file ?? a.path);

	const id =
		typeof a.id === 'string' && a.id.trim()
			? a.id.trim()
			: typeof a.name === 'string' && a.name.trim()
				? a.name.trim()
				: `${role}-${index + 1}`;

	a.id = (ROLE_SET.has(id) ? `${id}-main` : id).slice(0, 80);

	const firstPath = (a.scope as { path: string }[])[0]?.path;

	if (typeof a.title !== 'string' || !a.title.trim()) a.title = `${ROLE_LABELS[role]}: ${firstPath ?? 'changed files'}`;

	a.title = clip((a.title as string).trim(), 200);

	const reason = [a.reason, a.why, a.rationale, a.description].find(
		(value) => typeof value === 'string' && value.trim()
	);

	a.reason = clip((reason as string | undefined)?.trim() ?? 'Planned by the orchestrator.', 1000);
	a.questions = strings(a.questions ?? a.question, 12, 400);
	a.contextEvidenceIds = strings(a.contextEvidenceIds ?? a.evidenceIds, 20, 40);

	const priority =
		typeof a.priority === 'number' ? Math.trunc(a.priority) : Number.parseInt(String(a.priority ?? ''), 10);

	a.priority = Number.isFinite(priority) ? priority : index + 1;

	return [a];
}

/** Role decisions as a list or as an object keyed by role, with decision synonyms resolved. */
function normalizeRoleDecisions(raw: unknown): Record<string, unknown>[] {
	let decisions = raw;

	if (decisions && typeof decisions === 'object' && !Array.isArray(decisions)) {
		decisions = Object.entries(decisions as Record<string, unknown>).map(([role, value]) =>
			value && typeof value === 'object' ? { role, ...(value as object) } : { role, decision: value }
		);
	}

	return (Array.isArray(decisions) ? decisions : []).flatMap((entry) => {
		if (!entry || typeof entry !== 'object') return [];

		const d = { ...(entry as Record<string, unknown>) };
		const role = typeof d.role === 'string' ? resolveRole(d.role) : null;

		if (!role) return [];

		const decisionText = String(d.decision ?? d.status ?? d.selected ?? '')
			.trim()
			.toLowerCase()
			.replace(/[\s-]+/g, '_');

		d.role = role;
		d.decision = DECISION_ALIASES[decisionText] ?? 'not_needed';

		const reason = [d.reason, d.why].find((value) => typeof value === 'string' && value.trim());

		d.reason = clip((reason as string | undefined)?.trim() ?? 'No reason given.', 500);

		return [d];
	});
}

/**
 * Smaller models get the plan's shape right and the details wrong: a scope
 * written as a list of paths, an id equal to the role, "Security" for the
 * role, a missing priority or reason, roleDecisions as an object. Repair what
 * has one obvious meaning before validating, so a sound plan isn't thrown
 * away (and replaced by the far wider fallback) over formatting.
 */
export function normalizePlannerRaw(raw: unknown): unknown {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;

	let out = { ...(raw as Record<string, unknown>) };

	if (!Array.isArray(out.assignments) && out.plan && typeof out.plan === 'object' && !Array.isArray(out.plan))
		out = { ...out, ...(out.plan as Record<string, unknown>) };

	if (!Array.isArray(out.assignments)) {
		const alias = [out.specialists, out.tasks, out.investigations].find(Array.isArray);

		if (!alias) return out;

		out.assignments = alias;
	}

	const assignments = (out.assignments as unknown[]).slice(0, MAX_RAW_ASSIGNMENTS).flatMap(normalizeAssignment);

	out.assignments = assignments;

	const summary = [out.summary, out.message, out.overview].find(
		(value) => typeof value === 'string' && value.trim()
	) as string | undefined;

	out.summary = clip(
		summary?.trim() ?? `Planned ${assignments.length} specialist${assignments.length === 1 ? '' : 's'}.`,
		2000
	);

	out.roleDecisions = normalizeRoleDecisions(out.roleDecisions ?? out.roles ?? out.decisions);

	if (out.checks !== undefined) {
		const checks = strings(out.checks, REVIEW_POLICY.maxBaselineChecks, 300);

		if (checks.length) out.checks = checks;
		else delete out.checks;
	}

	if (out.message !== undefined && typeof out.message !== 'string') delete out.message;
	if (typeof out.message === 'string') out.message = clip(out.message, 12000);

	return out;
}
