import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { createReviewSession, queueReview, startReviewSession } from '../../commands/pipeline';
import { continueReviewSession, replayReviewSession } from '../../commands/rerun';
import { getReviewMetrics, type StoredMetrics } from '../../models/metrics';
import { isReviewConfigured } from '../../models/models';
import { cancelReviewChats, prepareDraftSession } from '../../review/chat/review-chat';
import { clearReviewEvents, emitReviewEvent } from '../../review/session/events';
import { getReviewControl, type ReviewControl } from '../../review/session/review-control';
import { isTerminalTask } from '../../review/session/task-state';
import {
	db,
	reviewCheckpoints,
	reviewDiffs,
	reviewMetrics,
	reviewProgress,
	reviewReplays,
	reviewSandboxes
} from '../../store';
import { parseBody } from '../parse-body';
import { requireReview } from './shared';
import { coordinator, storageTransaction } from '../../storage/backend';
import { enqueueCommand } from '../../review/runtime/inbox';
import { requestReviewControl } from '../../review/runtime/requests';
import { ReviewChatError } from '../../review/chat/chat-input';

const createReviewSchema = z.object({
	repoId: z.string().min(1),
	prNumber: z.number().int().positive(),
	headSha: z.string().min(1).max(100).optional(),
	start: z.boolean().optional(),
	baselineCache: z.literal(false).optional(),
	prTitle: z.string().max(500).optional(),
	postComment: z.boolean().optional(),
	instructions: z.string().max(4000).optional()
});

const app = new Hono();

/**
 * The running review's control, or the 404/409 response that ends the request.
 * A review that is not running has nothing to cancel, pause or resume.
 */
async function runningControl(c: Context): Promise<{ reviewId: string; control: ReviewControl } | Response> {
	const review = await requireReview(c);

	if (review instanceof Response) return review;

	const control = getReviewControl(review.id);

	if (!control) return c.json({ error: 'review is not running' }, 409);

	return { reviewId: review.id, control };
}

/**
 * Run `start` on a review session, answering 202 with its result. A missing
 * review is a 404; any other refusal (already running, nothing to continue) a 409.
 */
async function sessionAction(c: Context, start: (id: string) => Promise<unknown>, fallback: string): Promise<Response> {
	try {
		return c.json(await start(c.req.param('id') ?? ''), 202);
	} catch (err) {
		const message = err instanceof Error ? err.message : fallback;

		return c.json({ error: message }, message === 'review not found' ? 404 : 409);
	}
}

/** Every review without its context record, which only the single-review route serves: the list is polled and the record is large. */
app.get('/', async (c) => c.json((await db.reviews.list()).map(({ context: _context, ...review }) => review)));

/** Compact live progress per review, for the home dashboard's recent-session list. */
app.get('/progress-summaries', async (c) => {
	const summaries: Record<string, { tasksDone: number; tasksTotal: number; agents: number }> = {};

	for (const progress of await reviewProgress.list()) {
		const tasks = Object.values(progress.tasks ?? {});

		summaries[progress.id] = {
			tasksTotal: tasks.length,
			tasksDone: tasks.filter(isTerminalTask).length,
			agents: (progress.assignments ?? []).filter((assignment) => assignment.status === 'running').length
		};
	}

	return c.json(summaries);
});

app.get('/:id/metrics', async (c) => {
	c.header('Cache-Control', 'no-store');

	const review = await requireReview(c);

	if (review instanceof Response) return review;

	return c.json(await getReviewMetrics(review.id));
});

/**
 * The review's metrics row as stored, null when it has none: every call with the pipeline run that made it, and
 * each run's locked models, so a benchmark can record which models its review ran on.
 */
app.get('/:id/metrics/stored', async (c) => {
	c.header('Cache-Control', 'no-store');

	const review = await requireReview(c);

	if (review instanceof Response) return review;

	return c.json(((await reviewMetrics.get(review.id)) as StoredMetrics | undefined) ?? null);
});

app.get('/:id', async (c) => {
	const review = await requireReview(c);

	if (review instanceof Response) return review;

	return c.json(review);
});

app.delete('/:id', async (c) => {
	const review = await requireReview(c);

	if (review instanceof Response) return review;

	return storageTransaction(async (transaction) => {
		if (transaction) await enqueueCommand(transaction, review.id, { id: crypto.randomUUID(), kind: 'cancel' });
		getReviewControl(review.id)?.cancel();
		await db.reviews.delete(review.id);
		cancelReviewChats(review.id);
		await reviewDiffs.delete(review.id);
		await reviewMetrics.delete(review.id);
		await reviewCheckpoints.delete(review.id);
		await reviewReplays.delete(review.id);
		reviewSandboxes.delete(review.id);
		await clearReviewEvents(review.id);

		return c.json({ deleted: true });
	});
});

async function sharedControl(c: Context, kind: 'cancel' | 'pause' | 'resume'): Promise<Response> {
	try {
		await requestReviewControl(c.req.param('id') ?? '', kind);

		return c.json(kind === 'cancel' ? { cancelled: true } : { paused: kind === 'pause' });
	} catch (error) {
		if (error instanceof ReviewChatError) return c.json({ error: error.message }, error.status);
		throw error;
	}
}

/** Stop a running review. Findings so far are kept; it can be restarted. */
app.post('/:id/cancel', async (c) => {
	if (coordinator) return sharedControl(c, 'cancel');

	const running = await runningControl(c);

	if (running instanceof Response) return running;

	running.control.cancel();
	cancelReviewChats(running.reviewId);

	return c.json({ cancelled: true });
});

/** Hold a running review: in-flight model calls stop and re-run on resume. */
app.post('/:id/pause', async (c) => {
	if (coordinator) return sharedControl(c, 'pause');

	const running = await runningControl(c);

	if (running instanceof Response) return running;

	if (running.control.pause())
		emitReviewEvent(running.reviewId, {
			type: 'step',
			step: 'review',
			message: 'Review paused',
			data: { paused: true }
		});

	return c.json({ paused: true });
});

app.post('/:id/resume', async (c) => {
	if (coordinator) return sharedControl(c, 'resume');

	const running = await runningControl(c);

	if (running instanceof Response) return running;

	if (running.control.resume())
		emitReviewEvent(running.reviewId, {
			type: 'step',
			step: 'review',
			message: 'Review resumed',
			data: { paused: false }
		});

	return c.json({ paused: false });
});

/** Start a draft (interactive) review directly, without going through the orchestrator chat. */
app.post('/:id/start', (c) => sessionAction(c, startReviewSession, 'Could not start the review.'));

/** Continue a failed review from its last checkpoint. */
app.post('/:id/continue', (c) => sessionAction(c, continueReviewSession, 'Could not continue the review.'));

const replaySchema = z.object({ reverify: z.boolean().optional() });

/** Replay a passed review from its kept checkpoint, without its reviewers; for evals. */
app.post('/:id/replay', async (c) => {
	const body = await parseBody(c, replaySchema);

	if (body instanceof Response) return body;

	return sessionAction(
		c,
		async (id) => await replayReviewSession(id, body.reverify ?? false),
		'Could not replay the review.'
	);
});

app.post('/', async (c) => {
	const body = await parseBody(c, createReviewSchema);

	if (body instanceof Response) return body;

	try {
		if (body.start !== false) return c.json(await queueReview(body), 201);

		const review = await createReviewSession(body);

		if (coordinator) await prepareDraftSession(review.id, isReviewConfigured());
		else void prepareDraftSession(review.id, isReviewConfigured());

		return c.json(review, 201);
	} catch (err) {
		const error = err instanceof Error ? err.message : 'invalid input';

		return c.json(isReviewConfigured() ? { error } : { error, action: 'settings' }, 400);
	}
});

export default app;
