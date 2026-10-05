import { z } from 'zod';
import { FINDING_CATEGORIES, READABILITY_SMELLS, type FindingCategory } from '@recoder/shared';
import { findingShape } from './schemas.js';

/**
 * Words weaker models use for a category, mapped onto the closed list. A
 * category outside the list and this map makes the finding invalid, so it
 * never reaches a fingerprint under a made-up name.
 */
const CATEGORY_ALIASES: Record<string, FindingCategory> = {
	bug: 'correctness',
	logic: 'correctness',
	'logic-error': 'correctness',
	behavior: 'correctness',
	regression: 'correctness',
	robustness: 'error-handling',
	errors: 'error-handling',
	'error handling': 'error-handling',
	exceptions: 'error-handling',
	race: 'concurrency',
	'race-condition': 'concurrency',
	state: 'concurrency',
	api: 'api-contract',
	compatibility: 'api-contract',
	'breaking-change': 'api-contract',
	contract: 'api-contract',
	persistence: 'data-persistence',
	migration: 'data-persistence',
	data: 'data-persistence',
	perf: 'performance',
	intent: 'intent-mismatch',
	requirements: 'intent-mismatch',
	test: 'tests',
	testing: 'tests',
	rule: 'repo-rule',
	guideline: 'repo-rule',
	guidelines: 'repo-rule',
	style: 'convention',
	consistency: 'convention',
	conventions: 'convention',
	duplicate: 'duplication',
	duplicated: 'duplication',
	unused: 'dead-code',
	deadcode: 'dead-code',
	complex: 'complexity',
	maintainability: 'readability',
	naming: 'readability',
	clarity: 'readability'
};

const KNOWN: ReadonlySet<string> = new Set(FINDING_CATEGORIES);

/** The closed category for what a model wrote, or the input unchanged when nothing matches (the schema then rejects it). */
function normalizeCategory(value: unknown): unknown {
	if (typeof value !== 'string') return value;

	const key = value.trim().toLowerCase().replace(/_/g, '-');

	if (KNOWN.has(key)) return key;

	return CATEGORY_ALIASES[key] ?? CATEGORY_ALIASES[key.replace(/-/g, ' ')] ?? value;
}

const stepSchema = z.object({
	file: z.string().min(1).max(500),
	line: z.number().int().positive(),
	note: z.string().max(200).optional()
});

/** What a finding asserts, field by field (`FindingClaim`). */
const claimSchema = z.object({
	trigger: z.string().trim().min(1).max(600),
	executionPath: z.array(stepSchema).max(12).default([]),
	consequence: z.string().trim().min(1).max(600),
	violatedContract: z.string().trim().min(1).max(600),
	existingGuard: z.string().max(600).nullable().optional()
});

/** A find-and-replace a quality finding suggests; the verifier turns it into a checked patch. */
const fixEditSchema = z.object({
	file: z.string().min(1).max(500),
	find: z.string().min(1).max(4000),
	replace: z.string().max(4000)
});

const locationSchema = z.object({
	file: z.string().min(1).max(500),
	line: z.number().int().positive().optional(),
	endLine: z.number().int().positive().optional(),
	side: z.enum(['old', 'new']).optional()
});

/**
 * One finding as a lens reports it. The structured fields are canonical; the
 * body is how it reads. Rule, smell and example requirements per category are
 * checked when the candidate is validated, so one bad finding never fails the
 * lens's whole answer.
 */
export const reviewerFindingSchema = z.object({
	...findingShape(z.enum(['high', 'medium', 'low'])),
	side: z.enum(['old', 'new']).optional(),
	category: z.preprocess(normalizeCategory, z.enum(FINDING_CATEGORIES)),
	/** The enclosing symbol's qualified name from the change model, when there is one. */
	symbol: z.string().max(200).nullable().optional(),
	ruleId: z
		.string()
		.regex(/^R\d+$/)
		.nullable()
		.optional(),
	smell: z.enum(READABILITY_SMELLS).nullable().optional(),
	claim: claimSchema,
	/** Comparable existing code a convention finding rests on. */
	examples: z.array(stepSchema).max(6).default([]),
	fix: z.array(fixEditSchema).max(6).default([]),
	evidenceIds: z.array(z.string().min(1).max(40)).max(12).default([]),
	relatedLocations: z.array(locationSchema).max(20).optional()
});

export type ReviewerFinding = z.infer<typeof reviewerFindingSchema>;
