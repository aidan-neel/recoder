import { z } from 'zod';
import {
	parseReviewerOutput,
	reviewerResponseSchema,
	reviewerValidationError,
	type ReviewerOutput
} from '../reviewer.js';

const RESULTS = ['confirmed', 'disproved', 'not-applicable', 'unresolved'] as const;
const CONTRACT_KINDS = ['type', 'test', 'doc', 'intent', 'source'] as const;

const text = (max: number) => z.string().trim().max(max);

/** The fixed answer fields an investigator adds to the reviewer's final result, under `obligation`. */
const answerSchema = z.object({
	contractEvidence: z
		.array(z.object({ kind: z.enum(CONTRACT_KINDS), location: text(300), note: text(600) }))
		.max(8)
		.default([]),
	inputPartition: z
		.array(z.object({ label: text(80), input: text(400), expected: text(400) }))
		.max(8)
		.default([]),
	expectedBehavior: text(1000),
	attemptedCounterexample: z
		.object({ input: text(600), evidenceId: z.string().nullable().default(null), observed: text(1000) })
		.nullable()
		.default(null),
	result: z.enum(RESULTS),
	reason: text(1200)
});

type InvestigatorAnswer = z.infer<typeof answerSchema>;

/** An investigator's final result: the reviewer fields (findings for a confirmed answer) and its fixed answer. */
export interface InvestigatorOutput {
	output: ReviewerOutput;
	answer: InvestigatorAnswer;
}

const CONFIRMED_NEEDS_FINDING =
	'obligation.result: "confirmed" needs the defect reported in "findings"; report it there, or give another result';

function answerOf(raw: unknown) {
	return answerSchema.safeParse(
		raw && typeof raw === 'object' ? (raw as Record<string, unknown>).obligation : undefined
	);
}

/** The reviewer fields and the answer, or null when either is malformed or a confirmed answer reports no finding. */
export function parseInvestigatorOutput(raw: unknown): InvestigatorOutput | null {
	const output = parseReviewerOutput(raw);
	const answer = answerOf(raw);

	if (!output || !answer.success) return null;
	if (answer.data.result === 'confirmed' && !output.findings.length) return null;

	return { output, answer: answer.data };
}

/** The exact fields that are wrong, reviewer fields first. */
export function investigatorValidationError(raw: unknown): string {
	if (!parseReviewerOutput(raw)) return reviewerValidationError(raw);

	const answer = answerOf(raw);

	if (answer.success) return CONFIRMED_NEEDS_FINDING;

	return answer.error.issues
		.slice(0, 6)
		.map((issue) => `obligation.${issue.path.join('.') || 'root'}: ${issue.message}`)
		.join('; ');
}

const str = { type: 'string' };

const ANSWER_RESPONSE_SCHEMA = {
	type: 'object',
	properties: {
		contractEvidence: {
			type: 'array',
			items: {
				type: 'object',
				properties: { kind: { type: 'string', enum: [...CONTRACT_KINDS] }, location: str, note: str },
				required: ['kind', 'location', 'note']
			}
		},
		inputPartition: {
			type: 'array',
			items: {
				type: 'object',
				properties: { label: str, input: str, expected: str },
				required: ['label', 'input', 'expected']
			}
		},
		expectedBehavior: str,
		attemptedCounterexample: {
			type: ['object', 'null'],
			properties: { input: str, evidenceId: { type: ['string', 'null'] }, observed: str },
			required: ['input', 'observed']
		},
		result: { type: 'string', enum: [...RESULTS] },
		reason: str
	},
	required: ['contractEvidence', 'inputPartition', 'expectedBehavior', 'attemptedCounterexample', 'result', 'reason']
};

function withAnswer(final: Record<string, unknown>): Record<string, unknown> {
	return {
		...final,
		properties: { ...(final.properties as Record<string, unknown>), obligation: ANSWER_RESPONSE_SCHEMA },
		required: [...(final.required as string[]), 'obligation']
	};
}

/** The reviewer's turn shapes for guided decoding, with the answer required in the final result. */
export function investigatorResponseSchema(
	exec: boolean,
	finalTurn: boolean
): { name: string; schema: Record<string, unknown> } {
	const { name, schema } = reviewerResponseSchema(exec, finalTurn);

	if (finalTurn) return { name, schema: withAnswer(schema) };

	const [retrieval, final] = schema.anyOf as Record<string, unknown>[];

	return { name, schema: { anyOf: [retrieval, withAnswer(final)] } };
}

/** A minimal valid final answer, quoted back when the model gets the shape wrong. */
export const INVESTIGATOR_EXAMPLE = JSON.stringify({
	message: 'Zero is rejected upstream, so the truthy check cannot drop it.',
	findings: [],
	examinedHunks: [],
	gaps: [],
	blockers: [],
	subagents: [],
	unsettled: [],
	answered: [],
	recommendedChecks: [],
	obligation: {
		contractEvidence: [{ kind: 'source', location: 'src/api.ts:12', note: 'parseLimit rejects values below 1' }],
		inputPartition: [
			{ label: 'below', input: '0', expected: 'rejected by parseLimit' },
			{ label: 'at', input: '1', expected: 'one row' }
		],
		expectedBehavior: 'A limit of 0 never reaches this branch.',
		attemptedCounterexample: null,
		result: 'not-applicable',
		reason: 'Upstream validation makes zero unreachable here.'
	}
});
