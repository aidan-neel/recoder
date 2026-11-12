import { Hono, type Context } from 'hono';
import type { Review } from '@recoder/shared';
import { GhError } from '../../forge/cli';
import { FindingNotFoundError, publishFindingComment } from '../../forge/publish/finding-comment';
import { publishFindingsReview } from '../../forge/publish/findings-review';
import { PublishConflictError } from '../../forge/publish/forge';
import { publishPullComment } from '../../forge/publish/pull-comment';
import { requireReview } from './shared';

const app = new Hono();

/** A write that failed, as the status that says what to do: sign in (401), nothing there (404), not here (409), forge trouble (502). */
function publishFailure(c: Context, err: unknown): Response {
	const message = err instanceof Error ? err.message : 'Could not comment on the pull request.';

	if (err instanceof PublishConflictError) return c.json({ error: message }, 409);
	if (err instanceof FindingNotFoundError) return c.json({ error: message }, 404);

	if (err instanceof GhError) {
		if (err.kind === 'auth') return c.json({ error: message, kind: 'auth' }, 401);
		if (err.kind === 'not-found') return c.json({ error: message }, 404);
	}

	return c.json({ error: message }, 502);
}

/** Answer the review once `publish` wrote its comment. */
async function answer(c: Context, publish: (review: Review) => Promise<Review>): Promise<Response> {
	const review = await requireReview(c);

	if (review instanceof Response) return review;

	try {
		return c.json(await publish(review));
	} catch (err) {
		return publishFailure(c, err);
	}
}

/** Post the review's summary comment on the pull request, or bring the one it posted up to date. */
app.post('/:id/pull-comment', (c) => answer(c, (review) => publishPullComment(review.id)));

/** Post one finding on its diff line (a plain comment when the diff doesn't show the line), or update it. */
app.post('/:id/findings/:findingId/pull-comment', (c) =>
	answer(c, (review) => publishFindingComment(review.id, c.req.param('findingId')))
);

/**
 * Submit the finished review's verified findings as one forge review: a
 * summary, inline comments with suggestions, fixed threads resolved, and the
 * commit status. Answers the review as it is when its findings already went up.
 */
app.post('/:id/findings-review', (c) => answer(c, (review) => publishFindingsReview(review.id)));

export default app;
