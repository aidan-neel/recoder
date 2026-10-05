import { z } from 'zod';
import { clip } from './schemas.js';

/** The brief shows at most this many open questions, so a reply can account for no more. */
export const MAX_QUESTIONS = 12;

/** How a reviewer settled a brief question it was shown. */
const ANSWER_OUTCOMES = ['confirmed', 'disproved'] as const;

/**
 * A question a reviewer settled: `confirmed` means it reported the defect as a
 * finding in the same answer, `disproved` that the code is fine, with the
 * reason in `note`.
 */
export const answeredSchema = z.object({
	questionId: z.string(),
	outcome: z.enum(ANSWER_OUTCOMES),
	note: z.string().max(400)
});

export type QuestionAnswer = z.infer<typeof answeredSchema>;

/** "q3" and " Q3 " are Q3, or null when the text isn't a brief question id. */
function questionId(value: unknown): string | null {
	return typeof value === 'string' && /^q\d+$/i.test(value.trim()) ? value.trim().toUpperCase() : null;
}

/** The outcome a reply names, in any case, or null when it isn't one. */
function answerOutcome(value: unknown): QuestionAnswer['outcome'] | null {
	const text = typeof value === 'string' ? value.trim().toLowerCase() : '';

	return ANSWER_OUTCOMES.find((outcome) => outcome === text) ?? null;
}

/** The brief question ids in a list: anything that isn't one is dropped, and the rest is deduplicated. */
export function questionIds(value: unknown): string[] {
	const ids = (Array.isArray(value) ? value : []).flatMap((item) => questionId(item) ?? []);

	return [...new Set(ids)].slice(0, MAX_QUESTIONS);
}

/**
 * The answers in a reply that name a brief question and an outcome, a missing
 * note left empty, a repeated question kept once (the first answer). The id may
 * come as `id`, and the outcome in any case.
 */
export function normalizeAnswered(value: unknown): QuestionAnswer[] {
	const seen = new Set<string>();
	const answers: QuestionAnswer[] = [];

	for (const item of Array.isArray(value) ? value : []) {
		if (!item || typeof item !== 'object') continue;

		const record = item as Record<string, unknown>;
		const id = questionId(record.questionId ?? record.id);
		const outcome = answerOutcome(record.outcome);
		const note = typeof record.note === 'string' ? String(clip(record.note, 400)) : '';

		if (!id || !outcome || seen.has(id)) continue;

		seen.add(id);
		answers.push({ questionId: id, outcome, note });
	}

	return answers.slice(0, MAX_QUESTIONS);
}
