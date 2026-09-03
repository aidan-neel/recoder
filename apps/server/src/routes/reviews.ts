import { Hono } from 'hono';
import { z } from 'zod';
import { parseUnifiedDiff } from '@recoder/shared';
import { queueReview } from '../commands/pipeline';
import { subscribeReview } from '../lib/events';
import { discussFinding, discussRequestSchema } from '../lib/discuss';
import { LlmError } from '../lib/llm';
import { db, reviewDiffs, reviewSandboxes } from '../store';

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

/** Ask the finding's reviewer a follow-up, with file + diff context. */
app.post('/:id/discuss', async (c) => {
	const review = db.reviews.get(c.req.param('id'));
	if (!review) return c.json({ error: 'review not found' }, 404);
	const parsed = discussRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
	}
	const diff = reviewDiffs.get(review.id);
	if (!diff) return c.json({ error: 'no diff yet' }, 409);
	try {
		const result = await discussFinding({
			agent: parsed.data.agent,
			file: parsed.data.finding.file,
			line: parsed.data.finding.line,
			endLine: parsed.data.finding.endLine,
			severity: parsed.data.finding.severity,
			message: parsed.data.finding.message,
			history: parsed.data.history,
			question: parsed.data.question,
			diff,
			sandboxPath: reviewSandboxes.get(review.id) ?? null
		});
		return c.json(result);
	} catch (err) {
		if (err instanceof LlmError) return c.json({ error: err.message }, 502);
		throw err;
	}
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
