import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { createReviewSession, queueReview, startReviewSession } from '../../commands/pipeline';
import { continueReviewSession, replayReviewSession } from '../../commands/rerun';
import { getReviewMetrics } from '../../models/metrics';
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

const createReviewSchema = z.object({
	repoId: z.string().min(1),
	prNumber: z.number().int().positive(),
	headSha: z.string().min(1).max(100).optional(),
	start: z.boolean().optional(),
	baselineCache: z.literal(false).optional(),
	prTitle: z.string().max(500).optional()
});

const app = new Hono();

/**
 * The running review's control, or the 404/409 response that ends the request.
 * A review that is not running has nothing to cancel, pause or resume.
 */
function runningControl(c: Context): { reviewId: string; control: ReviewControl } | Response {
	const review = requireReview(c);

	if (review instanceof Response) return review;

	const control = getReviewControl(review.id);

	if (!control) return c.json({ error: 'review is not running' }, 409);

	return { reviewId: review.id, control };
}

/**
 * Run `start` on a review session, answering 202 with its result. A missing
 * review is a 404; any other refusal (already running, nothing to continue) a 409.
 */
function sessionAction(c: Context, start: (id: string) => unknown, fallback: string): Response {
	try {
		return c.json(start(c.req.param('id') ?? ''), 202);
	} catch (err) {
		const message = err instanceof Error ? err.message : fallback;

		return c.json({ error: message }, message === 'review not found' ? 404 : 409);
	}
}

/** Every review without its context record, which only the single-review route serves: the list is polled and the record is large. */
app.get('/', (c) => c.json(db.reviews.list().map(({ context: _context, ...review }) => review)));

/** Compact live progress per review, for the home dashboard's recent-session list. */
app.get('/progress-summaries', (c) => {
	const summaries: Record<string, { tasksDone: number; tasksTotal: number; agents: number }> = {};

	for (const progress of reviewProgress.list()) {
		const tasks = Object.values(progress.tasks ?? {});

		summaries[progress.id] = {
			tasksTotal: tasks.length,
			tasksDone: tasks.filter(isTerminalTask).length,
			agents: (progress.assignments ?? []).filter((assignment) => assignment.status === 'running').length
		};
	}

	return c.json(summaries);
});

app.get('/:id/metrics', (c) => {
	c.header('Cache-Control', 'no-store');

	const review = requireReview(c);

	if (review instanceof Response) return review;

	return c.json(getReviewMetrics(review.id));
});

app.get('/:id', (c) => {
	const review = requireReview(c);

	if (review instanceof Response) return review;

	return c.json(review);
});

app.delete('/:id', (c) => {
	const review = requireReview(c);

	if (review instanceof Response) return review;

	getReviewControl(review.id)?.cancel();
	db.reviews.delete(review.id);
	cancelReviewChats(review.id);
	reviewDiffs.delete(review.id);
	reviewMetrics.delete(review.id);
	reviewCheckpoints.delete(review.id);
	reviewReplays.delete(review.id);
	reviewSandboxes.delete(review.id);
	clearReviewEvents(review.id);

	return c.json({ deleted: true });
});

/** Stop a running review. Findings so far are kept; it can be restarted. */
app.post('/:id/cancel', (c) => {
	const running = runningControl(c);

	if (running instanceof Response) return running;

	running.control.cancel();
	cancelReviewChats(running.reviewId);

	return c.json({ cancelled: true });
});

/** Hold a running review: in-flight model calls stop and re-run on resume. */
app.post('/:id/pause', (c) => {
	const running = runningControl(c);

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

app.post('/:id/resume', (c) => {
	const running = runningControl(c);

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

	return sessionAction(c, (id) => replayReviewSession(id, body.reverify ?? false), 'Could not replay the review.');
});

app.post('/', async (c) => {
	const body = await parseBody(c, createReviewSchema);

	if (body instanceof Response) return body;

	try {
		if (body.start !== false) return c.json(queueReview(body), 201);

		const review = createReviewSession(body);

		void prepareDraftSession(review.id, isReviewConfigured());

		return c.json(review, 201);
	} catch (err) {
		return c.json({ error: err instanceof Error ? err.message : 'invalid input' }, 400);
	}
});

export default app;
