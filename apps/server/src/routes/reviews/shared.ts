import type { Context } from 'hono';
import type { z } from 'zod';
import type { Finding, Review } from '@recoder/shared';
import { modelFailure } from '../../models/model-failure';
import type { ModelConfig } from '../../models/models';
import { db, reviewDiffs } from '../../store';
import { parseBody } from '../parse-body';

/** The `:id` review, or the 404 response that ends the request. */
export async function requireReview(c: Context): Promise<Review | Response> {
	return (await db.reviews.get(c.req.param('id') ?? '')) ?? c.json({ error: 'review not found' }, 404);
}

/** The `:id` review and its finding `findingId`, or the 404 response that ends the request. */
export async function requireFinding(
	c: Context,
	findingId: string
): Promise<{ review: Review; finding: Finding } | Response> {
	const review = await requireReview(c);

	if (review instanceof Response) return review;

	const finding = review.findings.find((entry) => entry.id === findingId);

	return finding ? { review, finding } : c.json({ error: 'finding not found' }, 404);
}

/** The `:id` review and its parsed body, or the 404/400 response that ends the request. */
async function reviewWithBody<S extends z.ZodType>(
	c: Context,
	schema: S
): Promise<{ review: Review; body: z.infer<S> } | Response> {
	const review = await requireReview(c);

	if (review instanceof Response) return review;

	const body = await parseBody(c, schema);

	if (body instanceof Response) return body;

	return { review, body };
}

/**
 * The `:id` review, its parsed body and the PR diff the fetch step stored.
 * Answers 409 while there is no diff yet, since the model needs it as context.
 */
export async function reviewWithDiff<S extends z.ZodType>(
	c: Context,
	schema: S
): Promise<{ review: Review; body: z.infer<S>; diff: string } | Response> {
	const loaded = await reviewWithBody(c, schema);

	if (loaded instanceof Response) return loaded;

	const diff = await reviewDiffs.get(loaded.review.id);

	if (!diff) return c.json({ error: 'no diff yet' }, 409);

	return { ...loaded, diff };
}

/** A model error from writing a fix, as a 502 that says whether to wait out a usage limit. */
export function fixModelFailure(c: Context, err: unknown, config: ModelConfig): Response {
	const failure = modelFailure(err, config, 'The model could not write a fix. Try again.');

	return c.json({ error: failure.reason, ...(failure.usageLimit ? { usageLimit: failure.usageLimit } : {}) }, 502);
}
