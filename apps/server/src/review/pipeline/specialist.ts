import { z } from 'zod';
import { REVIEW_ROLES, ROLE_FOCUS, ROLE_LABELS, type ReviewRole } from './roles.js';
import { REVIEW_POLICY } from '../session/review-policy.js';
import {
	EXEC_REVIEW_CONTRACT,
	EXEC_REVIEW_CONTRACT_COMPACT,
	SHARED_REVIEW_CONTRACT,
	SHARED_REVIEW_CONTRACT_COMPACT
} from './prompts.js';
import type { PlannerAssignment } from './planner.js';
import { directiveBlock, type ReviewDirective } from '../chat/directive.js';

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
	severity: z.enum(['high', 'medium', 'low']),
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
	coverageGaps: z
		.array(z.object({ hunkId: z.string(), reason: z.string().max(400) }))
		.max(80)
		.default([]),
	blockers: z.array(z.string().max(400)).max(20).default([]),
	followUp: followUpSchema,
	recommendedChecks: z.array(z.string().max(400)).max(20).default([])
});

export type SpecialistOutput = z.infer<typeof specialistOutputSchema>;
export type SpecialistFinding = z.infer<typeof findingSchema>;

export function specialistSystemPrompt(
	role: ReviewRole,
	exec = false,
	options: { compact?: boolean; directive?: ReviewDirective | null } = {}
): string {
	const contract = options.compact
		? exec
			? EXEC_REVIEW_CONTRACT_COMPACT
			: SHARED_REVIEW_CONTRACT_COMPACT
		: exec
			? EXEC_REVIEW_CONTRACT
			: SHARED_REVIEW_CONTRACT;

	const directive = directiveBlock(options.directive);

	return `${contract}

Role: ${ROLE_LABELS[role]} (${role})
Focus: ${ROLE_FOCUS[role]}${directive ? `\n\n${directive}\nReport only what these instructions ask for; findings outside them are dropped.` : ''}`;
}

export function specialistUserPrompt(
	assignment: PlannerAssignment,
	remainingTurns: number,
	remainingCalls: number,
	directive?: ReviewDirective | null
): string {
	const scope = assignment.scope
		.map((entry) => `- ${entry.path}\n  hunks: ${entry.hunkIds.join(', ') || '(file)'}`)
		.join('\n');

	const questions = assignment.questions.map((question, i) => `${i + 1}. ${question}`).join('\n');

	return [
		directive?.instructions.trim()
			? `Developer instructions for this review (trusted; follow them):\n${directive.instructions.trim()}`
			: '',
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
	critical: 'high',
	blocker: 'high',
	major: 'high',
	error: 'high',
	moderate: 'medium',
	warning: 'medium',
	warn: 'medium',
	minor: 'low'
};

/** Informational notes aren't reported; a finding with one of these severities is dropped. */
const DROPPED_SEVERITIES = new Set(['info', 'informational', 'nit', 'trivial', 'note', 'suggestion', 'style']);

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

			if (DROPPED_SEVERITIES.has(severity)) return [];
			f.severity = SEVERITY_ALIASES[severity] ?? severity;
		}

		f.category ??= 'correctness';

		for (const key of ['line', 'endLine']) {
			const n = positiveInt(f[key]);

			if (n === undefined) delete f[key];
			else f[key] = n;
		}

		if (Array.isArray(f.evidenceIds))
			f.evidenceIds = f.evidenceIds.filter((id) => typeof id === 'string' && id).slice(0, 12);
		else if (typeof f.evidenceIds === 'string') f.evidenceIds = [f.evidenceIds];
		f.title = clipText(f.title, 120);
		f.body = clipText(f.body, 2000);
		if (typeof f.category === 'string') f.category = f.category.slice(0, 50);

		if (Array.isArray(f.relatedLocations)) {
			f.relatedLocations = f.relatedLocations.slice(0, 20).flatMap((loc) => {
				if (!loc || typeof loc !== 'object') return [];

				const l = { ...(loc as Record<string, unknown>) };

				for (const key of ['line', 'endLine']) {
					const n = positiveInt(l[key]);

					if (n == null) delete l[key];
					else l[key] = n;
				}

				return typeof l.file === 'string' ? [l] : [];
			});
		}

		return [f];
	});

	if (!Array.isArray(out.examinedHunks)) out.examinedHunks = [];

	out.examinedHunks = (out.examinedHunks as unknown[])
		.filter((id): id is string => typeof id === 'string')
		.slice(0, 200);

	if (Array.isArray(out.coverageGaps)) {
		out.coverageGaps = out.coverageGaps
			.slice(0, 80)
			.flatMap((gap) =>
				typeof gap === 'string'
					? [{ hunkId: gap, reason: 'not examined' }]
					: gap && typeof gap === 'object' && typeof (gap as { hunkId?: unknown }).hunkId === 'string'
						? [{ ...(gap as object), reason: clipText((gap as { reason?: unknown }).reason ?? 'not examined', 400) }]
						: []
			);
	}

	if (Array.isArray(out.blockers))
		out.blockers = out.blockers
			.filter((b) => typeof b === 'string')
			.map((b) => clipText(b, 400))
			.slice(0, 20);
	if (Array.isArray(out.recommendedChecks))
		out.recommendedChecks = out.recommendedChecks
			.filter((c) => typeof c === 'string')
			.map((c) => clipText(c, 400))
			.slice(0, 20);
	// A malformed follow-up is optional context; drop it rather than the whole answer.
	if (
		out.followUp !== undefined &&
		out.followUp !== null &&
		!specialistOutputSchema.shape.followUp.safeParse(out.followUp).success
	)
		out.followUp = null;

	return out;
}

/** "Let me check…", "I'll gather…": the model is describing work it hasn't done yet. */
const ANNOUNCES_WORK =
	/\b(let me|i'll|i will|i'm going to|i am going to|i need to|i'm (?:investigating|checking|looking|reading|gathering)|next,? i|going to (?:check|look|read|inspect|gather|verify))\b/i;

/**
 * Weaker models (often behind vLLM) send the final shape with an empty
 * findings list while announcing what they're about to read, which would end
 * the specialist before it looked at anything. Push back once.
 */
export function prematureSpecialistFinal(output: SpecialistOutput, state: { retrievals: number }): string | null {
	if (output.findings.length) return null;

	if (output.message && ANNOUNCES_WORK.test(output.message)) {
		return 'Your reply says you are still investigating, but it has the final result fields, which would end your review with no findings. If you want to read code, reply with "actions" now. Only send the final result once you have actually finished.';
	}

	if (state.retrievals === 0) {
		return 'You concluded with no findings without reading any code beyond the patch. Before concluding, read what the change touches: the full functions it edits, their callers, and anything it removed or replaced. Reply with "actions" now. If you are certain there is nothing more to read, send the same final result again.';
	}

	return null;
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

	return parsed.error.issues
		.slice(0, 6)
		.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
		.join('; ');
}

const SCHEMA_ACTIONS = ['readDiff', 'readFile', 'search', 'listFiles'];
const SCHEMA_EXEC_ACTIONS = [...SCHEMA_ACTIONS, 'run', 'writeFile'];

/**
 * What a specialist turn may look like, for endpoints with guided decoding:
 * a retrieval request with at least one action, or the final result. On the
 * final turn only the result is allowed. Kept looser than the zod schema:
 * it shapes the reply, and `parseSpecialistOutput` still validates it.
 */
export function specialistResponseSchema(
	exec: boolean,
	finalTurn: boolean
): { name: string; schema: Record<string, unknown> } {
	const str = { type: 'string' };
	const strings = { type: 'array', items: str };
	const line = { type: ['integer', 'null'] };

	const action = {
		type: 'object',
		properties: {
			action: { type: 'string', enum: exec ? SCHEMA_EXEC_ACTIONS : SCHEMA_ACTIONS },
			revision: { type: 'string', enum: ['head', 'target', 'mergeBase'] },
			path: str,
			query: str,
			prefix: str,
			cursor: str,
			hunkIds: strings,
			startLine: { type: 'integer' },
			endLine: { type: 'integer' },
			...(exec ? { command: str, content: str, timeoutSec: { type: 'integer' } } : {})
		},
		required: ['action']
	};

	const retrieval = {
		type: 'object',
		properties: {
			message: str,
			actions: { type: 'array', items: action, minItems: 1, maxItems: REVIEW_POLICY.maxRetrievalsPerTurn }
		},
		required: ['message', 'actions'],
		additionalProperties: false
	};

	const finding = {
		type: 'object',
		properties: {
			title: str,
			file: str,
			line,
			endLine: line,
			severity: { type: 'string', enum: ['high', 'medium', 'low'] },
			category: str,
			body: str,
			evidenceIds: strings,
			side: { type: 'string', enum: ['old', 'new'] }
		},
		required: ['title', 'file', 'severity', 'category', 'body', 'evidenceIds']
	};

	const final = {
		type: 'object',
		properties: {
			message: str,
			findings: { type: 'array', items: finding, maxItems: 30 },
			examinedHunks: strings,
			coverageGaps: {
				type: 'array',
				items: { type: 'object', properties: { hunkId: str, reason: str }, required: ['hunkId', 'reason'] }
			},
			blockers: strings,
			followUp: { anyOf: [{ type: 'object' }, { type: 'null' }] },
			recommendedChecks: strings
		},
		required: ['message', 'findings', 'examinedHunks']
	};

	return {
		name: finalTurn ? 'specialist_result' : 'specialist_turn',
		schema: finalTurn ? final : { anyOf: [retrieval, final] }
	};
}
