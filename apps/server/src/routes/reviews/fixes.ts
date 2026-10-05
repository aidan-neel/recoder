import { Hono, type Context } from 'hono';
import { withReviewMetrics } from '../../models/metrics';
import { LlmError } from '../../models/llm';
import { configForAgent } from '../../models/models';
import { patchApplies, suggestFix, suggestFixRequestSchema } from '../../review/fixes/fix';
import { CheckoutError, ensureReviewCheckout } from '../../review/session/review-checkout';
import { fixModelFailure, reviewWithDiff } from './shared';

const app = new Hono();

/** A checkout that could not be made, as its status with a note that fixes need one. */
function checkoutFailure(c: Context, err: unknown): Response | undefined {
	if (err instanceof CheckoutError)
		return c.json({ error: `Fixes need a local checkout of the pull request. ${err.message}` }, err.status);

	return undefined;
}

/**
 * Suggest a minimal unified-diff fix for one finding (on demand, not stored).
 * A missing model is reported first, before any checkout work.
 */
app.post('/:id/fixes/suggest', async (c) => {
	const loaded = await reviewWithDiff(c, suggestFixRequestSchema);

	if (loaded instanceof Response) return loaded;

	const { review, body, diff } = loaded;

	configForAgent(body.agent);

	let sandboxPath: string;

	try {
		sandboxPath = await ensureReviewCheckout(review);
	} catch (err) {
		const failure = checkoutFailure(c, err);

		if (failure) return failure;
		throw err;
	}

	try {
		const result = await withReviewMetrics(review.id, 'fix', () =>
			suggestFix({ agent: body.agent, ...body.finding, diff, sandboxPath })
		);

		const applies = await patchApplies(sandboxPath, result.patch);

		return c.json({ ...result, applies });
	} catch (err) {
		if (err instanceof LlmError) return fixModelFailure(c, err, configForAgent(body.agent));

		throw err;
	}
});

export default app;
