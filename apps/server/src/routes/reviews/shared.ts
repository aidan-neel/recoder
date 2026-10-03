import type { Context } from 'hono';
import type { z } from 'zod';
import type { Review } from '@recoder/shared';
import { fetchPullHeadRef, GhError } from '../../forge/gh';
import { fetchMergeHeadRef } from '../../forge/glab';
import { tokenEnv } from '../../forge/tokens';
import { modelFailure } from '../../models/model-failure';
import type { RoleConfig } from '../../models/models';
import { FixError } from '../../review/fixes/fix';
import { CheckoutError } from '../../review/session/review-checkout';
import { db, reviewDiffs } from '../../store';
import { parseBody } from '../parse-body';

/** The `:id` review, or the 404 response that ends the request. */
export function requireReview(c: Context): Review | Response {
	return db.reviews.get(c.req.param('id') ?? '') ?? c.json({ error: 'review not found' }, 404);
}

/** The `:id` review and its parsed body, or the 404/400 response that ends the request. */
export async function reviewWithBody<S extends z.ZodType>(
	c: Context,
	schema: S
): Promise<{ review: Review; body: z.infer<S> } | Response> {
	const review = requireReview(c);

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

	const diff = reviewDiffs.get(loaded.review.id);

	if (!diff) return c.json({ error: 'no diff yet' }, 409);

	return { ...loaded, diff };
}

/** A fix or checkout error as its own status, or undefined for anything else. */
export function fixFailure(c: Context, err: unknown): Response | undefined {
	if (err instanceof FixError || err instanceof CheckoutError) return c.json({ error: err.message }, err.status);

	return undefined;
}

/** Like `fixFailure`, and a forge CLI error becomes a 502. */
export function forgeFailure(c: Context, err: unknown): Response | undefined {
	if (err instanceof GhError) return c.json({ error: err.message }, 502);

	return fixFailure(c, err);
}

/** A model error from writing a fix, as a 502 that says whether to sign in or wait out a usage limit. */
export function fixModelFailure(c: Context, err: unknown, config: RoleConfig): Response {
	const failure = modelFailure(err, config, 'The model could not write a fix. Try again.');

	return c.json(
		{
			error: failure.reason,
			...(failure.signIn ? { action: 'sign-in' } : {}),
			...(failure.usageLimit ? { usageLimit: failure.usageLimit } : {})
		},
		502
	);
}

/** The branch the review's pull or merge request pushes to. */
export async function reviewHeadRef(review: Review, repoUrl: string): Promise<string> {
	return review.source === 'gitlab'
		? fetchMergeHeadRef(repoUrl, review.prNumber, tokenEnv('gitlab', repoUrl))
		: fetchPullHeadRef(repoUrl, review.prNumber);
}
