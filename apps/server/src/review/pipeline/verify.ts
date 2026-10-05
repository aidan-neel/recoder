import { z } from 'zod';
import type { ChangeIntent } from './intent/types.js';
import { clip, retrievalTurnSchema } from './schemas.js';

export {
	candidateLocation,
	citedEvidence,
	claimBlock,
	verifierSystemPrompt,
	verifierUserPrompt
} from './verify/prompts.js';
export type { VerifierNotes } from './verify/prompts.js';
export { settleVerdict, verifierPushBack, withOutcome } from './verify/settle.js';

const VERDICT_ALIASES: Record<string, 'confirmed' | 'refuted' | 'unverified'> = {
	confirmed: 'confirmed',
	verified: 'confirmed',
	reproduced: 'confirmed',
	proven: 'confirmed',
	true: 'confirmed',
	valid: 'confirmed',
	refuted: 'refuted',
	disproved: 'refuted',
	disproven: 'refuted',
	'not reproduced': 'refuted',
	not_reproduced: 'refuted',
	'false positive': 'refuted',
	false_positive: 'refuted',
	false: 'refuted',
	invalid: 'refuted',
	unverified: 'unverified',
	inconclusive: 'unverified',
	unknown: 'unverified',
	'cannot verify': 'unverified',
	unproven: 'unverified'
};

const verdictSchema = z.object({
	message: z.string().max(12000).optional(),
	verdict: z.enum(['confirmed', 'refuted', 'unverified']),
	reason: z.string().trim().min(1).max(600),
	evidenceIds: z.array(z.string().min(1).max(40)).max(12).default([]),
	/** A stated non-goal (`N2`) or stacked pull request (`#31`) that already covers the problem. */
	coveredBy: z.string().trim().min(1).max(40).optional(),
	/** What the cited run should show if the claim is true; optional because weak models leave it out. */
	expected: z.string().trim().min(1).max(300).optional()
});

export type VerdictOutput = z.infer<typeof verdictSchema>;

/** Repair what weaker models get wrong: verdict synonyms and casing, `explanation` for `reason`, a lone id string. */
export function parseVerdict(raw: unknown): VerdictOutput | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

	const out = { ...(raw as Record<string, unknown>) };
	const verdict = out.verdict ?? out.status ?? out.result;

	if (typeof verdict === 'string') out.verdict = VERDICT_ALIASES[verdict.trim().toLowerCase()] ?? verdict;
	else if (typeof verdict === 'boolean') out.verdict = verdict ? 'confirmed' : 'refuted';
	out.reason ??= out.explanation ?? out.details ?? out.summary ?? out.message;
	out.reason = clip(out.reason, 600);
	if (typeof out.evidenceIds === 'string') out.evidenceIds = [out.evidenceIds];
	if (Array.isArray(out.evidenceIds))
		out.evidenceIds = out.evidenceIds.filter((id) => typeof id === 'string' && id).slice(0, 12);
	if (typeof out.coveredBy !== 'string' || !out.coveredBy.trim()) delete out.coveredBy;
	if (typeof out.expected !== 'string' || !out.expected.trim()) delete out.expected;
	else out.expected = clip(out.expected.trim(), 300);

	const parsed = verdictSchema.safeParse(out);

	return parsed.success ? parsed.data : null;
}

export function verdictValidationError(raw: unknown): string {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'expected one JSON object';

	return 'expected {"message","verdict":"confirmed"|"refuted"|"unverified","reason","evidenceIds","expected"?,"coveredBy"?}';
}

/**
 * Whether a refutation rests on the change's own scope: a stated non-goal or
 * a stacked pull request that already covers the problem. The id must be one
 * the intent actually holds; a made-up one counts for nothing.
 */
export function coveredByIntent(output: VerdictOutput, intent: ChangeIntent | null): boolean {
	const cited = output.coveredBy?.trim();

	if (output.verdict !== 'refuted' || !cited || !intent) return false;
	if (intent.nonGoals.some((claim) => claim.id === cited)) return true;

	const number = /^#?(\d+)$/.exec(cited)?.[1];
	const stacked = [intent.stack.parent, ...intent.stack.children].filter((pr) => pr !== null);

	return Boolean(number) && stacked.some((pr) => String(pr.number) === number);
}

/** Verifier turns for endpoints with guided decoding: actions, or the verdict (only the verdict on the final turn). */
export function verifierResponseSchema(
	exec: boolean,
	finalTurn: boolean
): { name: string; schema: Record<string, unknown> } {
	const str = { type: 'string' };

	const verdict = {
		type: 'object',
		properties: {
			message: str,
			verdict: { type: 'string', enum: ['confirmed', 'refuted', 'unverified'] },
			reason: str,
			evidenceIds: { type: 'array', items: str },
			coveredBy: str
		},
		required: ['message', 'verdict', 'reason', 'evidenceIds']
	};

	if (finalTurn) return { name: 'verifier_verdict', schema: verdict };

	return { name: 'verifier_turn', schema: { anyOf: [retrievalTurnSchema(exec), verdict] } };
}
