import { Hono } from 'hono';
import { z } from 'zod';
import { homeBrief } from '../lib/home-brief';
import { LlmError } from '../lib/llm';
import { isReviewConfigured } from '../lib/models';
import { db } from '../store';

const briefSchema = z.object({
	name: z.string().max(60).nullish(),
	dayPart: z.enum(['morning', 'afternoon', 'evening', 'night']),
	prs: z
		.array(
			z.object({
				repoId: z.string().min(1).max(200),
				repo: z.string().min(1).max(200),
				number: z.number().int().positive(),
				title: z.string().max(500),
				additions: z.number().int().nonnegative(),
				deletions: z.number().int().nonnegative(),
				changedFiles: z.number().int().nonnegative(),
				createdAt: z.string().max(64)
			})
		)
		.max(200),
	emptyRepos: z.array(z.string().max(200)).max(100).optional()
});

const app = new Hono();

/** AI brief for the Home screen, written by the orchestrator's model. */
app.post('/brief', async (c) => {
	const parsed = briefSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
	}
	if (!isReviewConfigured()) return c.json({ error: 'No orchestrator model configured.' }, 503);
	try {
		return c.json(await homeBrief(parsed.data, db.reviews.list()));
	} catch (err) {
		if (err instanceof LlmError) return c.json({ error: err.message }, 502);
		throw err;
	}
});

export default app;
