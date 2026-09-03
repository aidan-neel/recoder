import { Hono } from 'hono';
import { z } from 'zod';
import type { Review } from '@recoder/shared';
import { runReviewPipeline } from '../commands/pipeline';
import { db } from '../store';

const createReviewSchema = z.object({
	repoId: z.string().min(1),
	prNumber: z.number().int().positive(),
	headSha: z.string().min(1).max(100).optional()
});

const app = new Hono();

app.get('/', (c) => c.json(db.reviews.list()));

app.get('/:id', (c) => {
	const review = db.reviews.get(c.req.param('id'));
	if (!review) return c.json({ error: 'review not found' }, 404);
	return c.json(review);
});

app.post('/', async (c) => {
	const parsed = createReviewSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
	}
	if (!db.repos.get(parsed.data.repoId)) {
		return c.json({ error: 'repo not found' }, 400);
	}
	const now = new Date().toISOString();
	const review: Review = {
		id: crypto.randomUUID(),
		repoId: parsed.data.repoId,
		prNumber: parsed.data.prNumber,
		headSha: parsed.data.headSha ?? 'unknown',
		status: 'queued',
		summary: null,
		findings: [],
		runs: [],
		createdAt: now,
		updatedAt: now
	};
	db.reviews.set(review);
	// Run the pipeline in the background; the client polls GET /api/reviews/:id.
	void runReviewPipeline(review.id).catch((err) => console.error('[reviews] pipeline failed', err));
	return c.json(review, 201);
});

export default app;
