import { z } from 'zod';
import { REVIEW_ROLES, ROLE_FOCUS, ROLE_LABELS, type ReviewRole } from './roles.js';
import { REVIEW_POLICY } from './review-policy.js';
import { EXEC_REVIEW_CONTRACT, SHARED_REVIEW_CONTRACT } from './prompts.js';
import type { PlannerAssignment } from './planner.js';

const locationSchema = z.object({
	file: z.string().min(1).max(500),
	line: z.number().int().positive().optional(),
	endLine: z.number().int().positive().optional(),
	side: z.enum(['old', 'new']).optional()
});

const findingSchema = z.object({
	title: z.string().trim().min(1).max(120).optional(),
	file: z.string().min(1).max(500),
	line: z.number().int().positive().nullable().optional(),
	endLine: z.number().int().positive().nullable().optional(),
	severity: z.enum(['high', 'medium', 'low', 'info']),
	category: z.string().min(1).max(50),
	body: z.string().min(1).max(2000),
	evidenceIds: z.array(z.string().min(1).max(40)).max(12).default([]),
	relatedLocations: z.array(locationSchema).max(20).optional(),
	side: z.enum(['old', 'new']).optional()
});

const followUpSchema = z
	.object({
		id: z.string().min(1).max(80),
		role: z.enum(REVIEW_ROLES),
		title: z.string().min(1).max(200),
		reason: z.string().min(1).max(1000),
		scope: z
			.array(
				z.object({
					path: z.string().min(1).max(500),
					hunkIds: z.array(z.string()).max(80)
				})
			)
			.min(1)
			.max(20),
		questions: z.array(z.string()).max(12).default([]),
		priority: z.number().int().optional().default(50),
		contextEvidenceIds: z.array(z.string()).max(20).optional().default([])
	})
	.nullable()
	.optional();

export const specialistOutputSchema = z.object({
	message: z.string().max(12000).optional(),
	findings: z.array(findingSchema).max(30),
	examinedHunks: z.array(z.string()).max(200),
	coverageGaps: z.array(z.object({ hunkId: z.string(), reason: z.string().max(400) })).max(80).default([]),
	blockers: z.array(z.string().max(400)).max(20).default([]),
	followUp: followUpSchema,
	recommendedChecks: z.array(z.string().max(400)).max(20).default([])
});

export type SpecialistOutput = z.infer<typeof specialistOutputSchema>;
export type SpecialistFinding = z.infer<typeof findingSchema>;

export function specialistSystemPrompt(role: ReviewRole, exec = false): string {
	return `${exec ? EXEC_REVIEW_CONTRACT : SHARED_REVIEW_CONTRACT}

Role: ${ROLE_LABELS[role]} (${role})
Focus: ${ROLE_FOCUS[role]}`;
}

export function specialistUserPrompt(assignment: PlannerAssignment, remainingTurns: number, remainingCalls: number): string {
	const scope = assignment.scope
		.map((entry) => `- ${entry.path}\n  hunks: ${entry.hunkIds.join(', ') || '(file)'}`)
		.join('\n');
	const questions = assignment.questions.map((question, i) => `${i + 1}. ${question}`).join('\n');
	return [
		`Assignment ${assignment.id}: ${assignment.title}`,
		`Why this assignment exists: ${assignment.reason}`,
		`Questions:\n${questions || '(none)'}`,
		`Scoped changes:\n${scope}`,
		assignment.contextEvidenceIds.length ? `Context evidence: ${assignment.contextEvidenceIds.join(', ')}` : '',
		`Remaining model turns for this assignment: ${remainingTurns}. Remaining review model calls: ${remainingCalls}.`,
		remainingTurns <= 1
			? 'This is your final turn. Finish with the specialist JSON. Do not request more retrieval.'
			: 'Retrieve evidence as needed, then finish with the specialist JSON.'
	]
		.filter(Boolean)
		.join('\n\n');
}

const SEVERITY_ALIASES: Record<string, string> = {
	critical: 'high', blocker: 'high', major: 'high', error: 'high',
	moderate: 'medium', warning: 'medium', warn: 'medium',
	minor: 'low', nit: 'info', trivial: 'info', note: 'info', suggestion: 'info', style: 'info'
};

function positiveInt(value: unknown): number | null | undefined {
	if (value === null) return null;
	const n = typeof value === 'string' ? Number.parseInt(value, 10) : value;
	return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.trunc(n) : undefined;
}

function clipText(value: unknown, max: number): unknown {
	return typeof value === 'string' && value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Smaller models get the shape right but the details wrong: "42" for a line,
 * "High" or "critical" for a severity, `description` for `body`, a missing
 * `examinedHunks`, an over-long body. Repair what has one obvious meaning
 * before validating, so a sound answer isn't thrown away over formatting.
 */
export function normalizeSpecialistRaw(raw: unknown): unknown {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
	// Only repair an attempted final answer; a bare "message" is commentary, not a finished review.
	if (!Array.isArray((raw as { findings?: unknown }).findings)) return raw;
	const out = { ...(raw as Record<string, unknown>) };
	if (typeof out.message !== 'string' && typeof out.summary === 'string') out.message = out.summary;
	if (out.message !== undefined) out.message = clipText(out.message, 12000);
	out.findings = (out.findings as unknown[]).slice(0, 30).flatMap((item) => {
		if (!item || typeof item !== 'object') return [];
		const f = { ...(item as Record<string, unknown>) };
		f.file ??= f.path ?? f.filePath ?? f.file_path;
		f.body ??= f.description ?? f.explanation ?? f.details ?? f.message;
		if (typeof f.severity === 'string') {
			const severity = f.severity.trim().toLowerCase();
			f.severity = SEVERITY_ALIASES[severity] ?? severity;
		}
		f.category ??= 'correctness';
		for (const key of ['line', 'endLine']) {
			const n = positiveInt(f[key]);
			if (n === undefined) delete f[key]; else f[key] = n;
		}
		if (Array.isArray(f.evidenceIds)) f.evidenceIds = f.evidenceIds.filter((id) => typeof id === 'string' && id).slice(0, 12);
		else if (typeof f.evidenceIds === 'string') f.evidenceIds = [f.evidenceIds];
		f.title = clipText(f.title, 120);
		f.body = clipText(f.body, 2000);
		if (typeof f.category === 'string') f.category = f.category.slice(0, 50);
		if (Array.isArray(f.relatedLocations)) {
			f.relatedLocations = f.relatedLocations.slice(0, 20).flatMap((loc) => {
				if (!loc || typeof loc !== 'object') return [];
				const l = { ...(loc as Record<string, unknown>) };
				for (const key of ['line', 'endLine']) { const n = positiveInt(l[key]); if (n == null) delete l[key]; else l[key] = n; }
				return typeof l.file === 'string' ? [l] : [];
			});
		}
		return [f];
	});
	if (!Array.isArray(out.examinedHunks)) out.examinedHunks = [];
	out.examinedHunks = (out.examinedHunks as unknown[]).filter((id): id is string => typeof id === 'string').slice(0, 200);
	if (Array.isArray(out.coverageGaps)) {
		out.coverageGaps = out.coverageGaps.slice(0, 80).flatMap((gap) => typeof gap === 'string' ? [{ hunkId: gap, reason: 'not examined' }]
			: gap && typeof gap === 'object' && typeof (gap as { hunkId?: unknown }).hunkId === 'string' ? [{ ...(gap as object), reason: clipText((gap as { reason?: unknown }).reason ?? 'not examined', 400) }] : []);
	}
	if (Array.isArray(out.blockers)) out.blockers = out.blockers.filter((b) => typeof b === 'string').map((b) => clipText(b, 400)).slice(0, 20);
	if (Array.isArray(out.recommendedChecks)) out.recommendedChecks = out.recommendedChecks.filter((c) => typeof c === 'string').map((c) => clipText(c, 400)).slice(0, 20);
	// A malformed follow-up is optional context; drop it rather than the whole answer.
	if (out.followUp !== undefined && out.followUp !== null && !specialistOutputSchema.shape.followUp.safeParse(out.followUp).success) out.followUp = null;
	return out;
}

export function parseSpecialistOutput(raw: unknown): SpecialistOutput | null {
	const parsed = specialistOutputSchema.safeParse(normalizeSpecialistRaw(raw));
	return parsed.success ? parsed.data : null;
}

/** Name the exact fields that are wrong, so the model can fix them instead of guessing. */
export function specialistValidationError(raw: unknown): string {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'expected one JSON object';
	const parsed = specialistOutputSchema.safeParse(normalizeSpecialistRaw(raw));
	if (parsed.success) return 'output did not match the required schema';
	return parsed.error.issues.slice(0, 6).map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`).join('; ');
}
