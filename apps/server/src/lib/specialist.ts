import { z } from 'zod';
import { REVIEW_ROLES, ROLE_FOCUS, ROLE_LABELS, type ReviewRole } from './roles.js';
import { REVIEW_POLICY } from './review-policy.js';
import { SHARED_REVIEW_CONTRACT } from './prompts.js';
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

export function specialistSystemPrompt(role: ReviewRole): string {
	return `${SHARED_REVIEW_CONTRACT}

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

export function parseSpecialistOutput(raw: unknown): SpecialistOutput | null {
	const parsed = specialistOutputSchema.safeParse(raw);
	return parsed.success ? parsed.data : null;
}
