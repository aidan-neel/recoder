import { z } from 'zod';
import { REVIEW_ROLES, type ReviewRole } from '../roles.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import type { DispatchPolicy } from '../dispatch.js';
import type { ReviewDirective } from '../../chat/directive.js';
import { assignmentShape } from '../schemas.js';

const assignmentSchema = z.object({
	...assignmentShape(z.string().min(1).max(300), 40),
	questions: z.array(z.string().min(1).max(400)).max(12),
	contextEvidenceIds: z.array(z.string().min(1).max(40)).max(20),
	priority: z.number().int()
});

/** More than any dispatch level allows; the surplus is clipped, not rejected. */
export const MAX_RAW_ASSIGNMENTS = 40;

export const plannerOutputSchema = z.object({
	message: z.string().max(12000).optional(),
	summary: z.string().min(1).max(2000),
	assignments: z.array(assignmentSchema).max(MAX_RAW_ASSIGNMENTS),
	roleDecisions: z.array(
		z.object({
			role: z.enum(REVIEW_ROLES),
			decision: z.enum(['selected', 'not_needed', 'deferred']),
			reason: z.string().min(1).max(500)
		})
	),
	/** Shell commands run once on the PR head, before specialists start, when the review can run code. */
	checks: z.array(z.string().trim().min(1).max(300)).max(REVIEW_POLICY.maxBaselineChecks).optional()
});

export type PlannerAssignment = z.infer<typeof assignmentSchema>;
export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

export interface PlanOptions {
	/** A follow-up pass: no mandatory roles, no sweeps, no same-role folding. */
	followUp?: boolean;
	maxAssignments?: number;
	dispatch?: DispatchPolicy;
	directive?: ReviewDirective | null;
}

/** Role ids, which an assignment id must never equal. */
export const ROLE_SET = new Set<string>(REVIEW_ROLES);

/** Which roles this review may run: the developer's list when they gave one, else all. */
export function allowedRoles(directive: ReviewDirective | null | undefined): ReadonlySet<ReviewRole> {
	return new Set(directive?.roles.length ? directive.roles : REVIEW_ROLES);
}
