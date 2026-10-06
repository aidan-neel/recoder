import { z } from 'zod';
import {
	CONTRACT_EVIDENCE_RESPONSE,
	COUNTEREXAMPLE_RESPONSE,
	contractEvidenceSchema,
	counterexampleSchema
} from './answer-evidence.js';
import { clip } from './schemas.js';

/** The brief shows at most this many open questions, so a reply can account for no more. */
export const MAX_QUESTIONS = 12;

/** How a reviewer settled a brief question it was shown; one it could not settle goes in `unsettled` instead. */
const ANSWER_OUTCOMES = ['confirmed', 'disproved', 'not-applicable'] as const;

/**
 * A reviewer's answer to a brief question: `confirmed` when a finding in the
 * same reply names the question, `disproved` with the reason in `note` and a
 * source trace or a run behind it, `not-applicable` when the question is
 * outside its lens. The evidence fields are an obligation answer's (#66).
 */
export const answeredSchema = z.object({
	questionId: z.string(),
	outcome: z.enum(ANSWER_OUTCOMES),
	note: z.string().max(400),
	contractEvidence: contractEvidenceSchema,
	attemptedCounterexample: counterexampleSchema
});

export type ReplyAnswer = z.infer<typeof answeredSchema>;

/** `answeredSchema` for guided decoding. */
export const ANSWERED_RESPONSE = {
	type: 'array',
	items: {
		type: 'object',
		properties: {
			questionId: { type: 'string' },
			outcome: { type: 'string', enum: [...ANSWER_OUTCOMES] },
			note: { type: 'string' },
			contractEvidence: CONTRACT_EVIDENCE_RESPONSE,
			attemptedCounterexample: COUNTEREXAMPLE_RESPONSE
		},
		required: ['questionId', 'outcome', 'note']
	}
};

/** "q3" and " Q3 " are Q3, or null when the value isn't a brief question id. */
export function briefQuestionId(value: unknown): string | null {
	return typeof value === 'string' && /^q\d+$/i.test(value.trim()) ? value.trim().toUpperCase() : null;
}

/** The outcome a reply names, in any case and with "not applicable" spelled any usual way, or null when it isn't one. */
function answerOutcome(value: unknown): ReplyAnswer['outcome'] | null {
	const text =
		typeof value === 'string'
			? value
					.trim()
					.toLowerCase()
					.replace(/[\s_]+/g, '-')
			: '';

	const outcome = text === 'n/a' ? 'not-applicable' : text;

	return ANSWER_OUTCOMES.find((known) => known === outcome) ?? null;
}

/** The brief question ids in a list: anything that isn't one is dropped, and the rest is deduplicated. */
export function questionIds(value: unknown): string[] {
	const ids = (Array.isArray(value) ? value : []).flatMap((item) => briefQuestionId(item) ?? []);

	return [...new Set(ids)].slice(0, MAX_QUESTIONS);
}

/**
 * The answers in a reply that name a brief question and an outcome, a missing
 * note left empty and malformed evidence left out, a repeated question kept
 * once (the first answer). The id may come as `id`, and the outcome in any case.
 */
export function normalizeAnswered(value: unknown): ReplyAnswer[] {
	const seen = new Set<string>();
	const answers: ReplyAnswer[] = [];

	for (const item of Array.isArray(value) ? value : []) {
		if (!item || typeof item !== 'object') continue;

		const record = item as Record<string, unknown>;
		const id = briefQuestionId(record.questionId ?? record.id);
		const outcome = answerOutcome(record.outcome);

		if (!id || !outcome || seen.has(id)) continue;

		const trace = contractEvidenceSchema.safeParse(record.contractEvidence);
		const run = counterexampleSchema.safeParse(record.attemptedCounterexample);

		seen.add(id);

		answers.push({
			questionId: id,
			outcome,
			note: typeof record.note === 'string' ? String(clip(record.note, 400)) : '',
			contractEvidence: trace.success ? trace.data : [],
			attemptedCounterexample: run.success ? run.data : null
		});
	}

	return answers.slice(0, MAX_QUESTIONS);
}
