import { Hono } from 'hono';
import { z } from 'zod';
import type { Finding, Review } from '@recoder/shared';
import { withReviewMetrics } from '../../models/metrics';
import { LlmError } from '../../models/llm';
import { ModelConfigError } from '../../models/models';
import {
	discussFinding,
	discussRequestSchema,
	streamDiscussFinding,
	type DiscussInput
} from '../../review/chat/discuss';
import {
	ReviewChatError,
	reviewCodeContextSchema,
	startReviewChat,
	stopReviewChat
} from '../../review/chat/review-chat';
import { findReviewCheckout } from '../../review/session/review-checkout';
import { rereviewRequestSchema, runRereview } from '../../review/session/rereview';
import { db } from '../../store';
import { reviewWithDiff } from './shared';

const chatSchema = z.object({
	assignmentId: z.string().min(1).max(100),
	text: z.string().trim().min(1).max(8000),
	codeContext: reviewCodeContextSchema.optional()
});

const app = new Hono();

/** The discuss endpoints' model input: the finding, the thread so far, the diff and the checkout to read from. */
async function discussInput(
	review: Review,
	body: z.infer<typeof discussRequestSchema>,
	diff: string
): Promise<DiscussInput> {
	return {
		agent: body.agent,
		...body.finding,
		history: body.history,
		question: body.question,
		diff,
		sandboxPath: await findReviewCheckout(review)
	};
}

/**
 * Keep only the re-review findings the review does not have yet and store
 * them, so a refresh keeps them. Returns what was new.
 */
function mergeNewFindings(reviewId: string, findings: Finding[]): Finding[] {
	const current = db.reviews.get(reviewId);

	if (!current) return findings;

	const key = (f: Finding) => `${f.file}:${f.line ?? ''}:${f.message}`;
	const seen = new Set(current.findings.map(key));
	const fresh = findings.filter((f) => !seen.has(key(f)));

	if (fresh.length > 0) {
		db.reviews.set({
			...current,
			findings: [...current.findings, ...fresh],
			updatedAt: new Date().toISOString()
		});
	}

	return fresh;
}

app.post('/:id/chat', async (c) => {
	const parsed = chatSchema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success)
		return c.json({ error: 'Enter a message of at most 8,000 characters and a valid code selection.' }, 400);

	try {
		return c.json(
			startReviewChat(c.req.param('id'), parsed.data.assignmentId, parsed.data.text, parsed.data.codeContext),
			202
		);
	} catch (error) {
		if (error instanceof ReviewChatError) return c.json({ error: error.message }, error.status);

		return c.json({ error: 'Add a reviewer model in Settings → Models before sending a message.' }, 409);
	}
});

app.post('/:id/chat/stop', async (c) => {
	if (!db.reviews.get(c.req.param('id'))) return c.json({ error: 'review not found' }, 404);

	const parsed = chatSchema.pick({ assignmentId: true }).safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) return c.json({ error: 'Invalid conversation.' }, 400);
	stopReviewChat(c.req.param('id'), parsed.data.assignmentId);

	return c.json({ stopped: true });
});

/** Ask the finding's reviewer a follow-up, with file + diff context. */
app.post('/:id/discuss', async (c) => {
	const loaded = await reviewWithDiff(c, discussRequestSchema);

	if (loaded instanceof Response) return loaded;

	const input = await discussInput(loaded.review, loaded.body, loaded.diff);

	try {
		return c.json(await withReviewMetrics(loaded.review.id, 'discussion', () => discussFinding(input)));
	} catch (err) {
		if (err instanceof LlmError) return c.json({ error: err.message }, 502);
		throw err;
	}
});

/** Stream a follow-up reply as server-sent events (`token` chunks, then `done`). */
app.post('/:id/discuss/stream', async (c) => {
	const loaded = await reviewWithDiff(c, discussRequestSchema);

	if (loaded instanceof Response) return loaded;

	const input = await discussInput(loaded.review, loaded.body, loaded.diff);

	const stream = new ReadableStream({
		async start(controller) {
			const send = (data: unknown) => {
				controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
			};

			try {
				const result = await withReviewMetrics(loaded.review.id, 'discussion', () =>
					streamDiscussFinding(input, (text) => send({ type: 'token', text }))
				);

				send({ type: 'done', ...result });
			} catch (err) {
				send({
					type: 'error',
					error:
						err instanceof LlmError || err instanceof ModelConfigError ? err.message : 'The reviewer did not respond.'
				});
			} finally {
				controller.close();
			}
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

/**
 * Developer notes → batch re-review pass. The model answers each note and may
 * add findings, which are merged into the stored review so a refresh keeps them.
 */
app.post('/:id/rereview', async (c) => {
	const loaded = await reviewWithDiff(c, rereviewRequestSchema);

	if (loaded instanceof Response) return loaded;

	const { review, body, diff } = loaded;
	const sandboxPath = await findReviewCheckout(review);

	try {
		const result = await withReviewMetrics(review.id, 'discussion', () =>
			runRereview({
				notes: body.notes,
				diff,
				sandboxPath,
				existingFindings: review.findings
			})
		);

		if (result.findings.length > 0) result.findings = mergeNewFindings(review.id, result.findings);

		return c.json(result);
	} catch (err) {
		if (err instanceof LlmError) return c.json({ error: err.message }, 502);
		throw err;
	}
});

export default app;
