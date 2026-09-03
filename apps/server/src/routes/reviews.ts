import { Hono } from 'hono';
import { z } from 'zod';
import { parseUnifiedDiff } from '@recoder/shared';
import { queueReview } from '../commands/pipeline';
import { subscribeReview } from '../lib/events';
import { db, reviewDiffs } from '../store';

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

/** Parsed unified diff for a review (404 until the fetch step stores one). */
app.get('/:id/files', (c) => {
	const review = db.reviews.get(c.req.param('id'));
	if (!review) return c.json({ error: 'review not found' }, 404);
	const diff = reviewDiffs.get(review.id);
	if (!diff) return c.json({ error: 'no diff yet' }, 404);
	return c.json(parseUnifiedDiff(diff));
});

/** Live pipeline events (fetch/sandbox/agent progress) as server-sent events. */
app.get('/:id/events', (c) => {
	const review = db.reviews.get(c.req.param('id'));
	if (!review) return c.json({ error: 'review not found' }, 404);
	let unsubscribe: (() => void) | undefined;
	const stream = new ReadableStream({
		start(controller) {
			const send = (data: unknown) => {
				controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
			};
			send({ type: 'step', step: 'status', message: `status: ${review.status}` });
			unsubscribe = subscribeReview(review.id, send);
		},
		cancel() {
			unsubscribe?.();
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive'
		}
	});
});

app.post('/', async (c) => {
	const parsed = createReviewSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
	}
	try {
		return c.json(queueReview(parsed.data), 201);
	} catch (err) {
		return c.json({ error: err instanceof Error ? err.message : 'invalid input' }, 400);
	}
});

export default app;
