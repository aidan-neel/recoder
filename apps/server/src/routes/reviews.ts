import { Hono } from 'hono';
import { z } from 'zod';
import { emptyReviewProgress, expandFileDiff, parseUnifiedDiff } from '@recoder/shared';
import { queueReview } from '../commands/pipeline';
import { clearReviewEvents, subscribeReview } from '../lib/events';
import { discussFinding, streamDiscussFinding, discussRequestSchema } from '../lib/discuss';
import { runRereview, rereviewRequestSchema } from '../lib/rereview';
import { readSandboxFile } from '../lib/harness';
import {
	applyFixCommit,
	applyFixRequestSchema,
	FixError,
	patchApplies,
	pushFixBranch,
	suggestFix,
	suggestFixRequestSchema
} from '../lib/fix';
import { GhError, fetchPullHeadRef } from '../lib/gh';
import { fetchMergeHeadRef } from '../lib/glab';
import { LlmError } from '../lib/llm';
import { refspecFor } from '../lib/providers';
import { db, reviewDiffs, reviewSandboxes, reviewProgress, reviewMetrics } from '../store';
import { getReviewMetrics, withReviewMetrics } from '../lib/metrics';
import { cancelReviewChats, ReviewChatError, startReviewChat, stopReviewChat } from '../lib/review-chat';

const createReviewSchema = z.object({
	repoId: z.string().min(1),
	prNumber: z.number().int().positive(),
	headSha: z.string().min(1).max(100).optional()
});

const app = new Hono();

app.get('/', (c) => c.json(db.reviews.list()));

/** Compact live progress per review, for the home dashboard's recent-session list. */
app.get('/progress-summaries', (c) => {
	const summaries: Record<
		string,
		{ tasksDone: number; tasksTotal: number; specialists: number }
	> = {};
	for (const progress of reviewProgress.list()) {
		const tasks = Object.values(progress.tasks ?? {});
		summaries[progress.id] = {
			tasksTotal: tasks.length,
			tasksDone: tasks.filter(
				(task) =>
					task.status === 'done' || task.status === 'skipped' || task.status === 'error'
			).length,
			specialists: (progress.assignments ?? []).filter(
				(assignment) => assignment.status === 'running'
			).length
		};
	}
	return c.json(summaries);
});

app.get('/:id/metrics', (c) => {
	c.header('Cache-Control', 'no-store');
	const id = c.req.param('id');
	if (!db.reviews.get(id)) return c.json({ error: 'review not found' }, 404);
	return c.json(getReviewMetrics(id));
});

app.get('/:id', (c) => {
	const review = db.reviews.get(c.req.param('id'));
	if (!review) return c.json({ error: 'review not found' }, 404);
	return c.json(review);
});

app.delete('/:id', (c) => {
	const review = db.reviews.get(c.req.param('id'));
	if (!review) return c.json({ error: 'review not found' }, 404);
	db.reviews.delete(review.id);
	cancelReviewChats(review.id);
	reviewDiffs.delete(review.id);
	reviewMetrics.delete(review.id);
	reviewSandboxes.delete(review.id);
	clearReviewEvents(review.id);
	return c.json({ deleted: true });
});

/** Parsed unified diff for a review (404 until the fetch step stores one). */
app.get('/:id/files', async (c) => {
	const review = db.reviews.get(c.req.param('id'));
	if (!review) return c.json({ error: 'review not found' }, 404);
	const diff = reviewDiffs.get(review.id);
	if (!diff) return c.json({ error: 'no diff yet' }, 404);
	const files = parseUnifiedDiff(diff);
	const sandboxPath = reviewSandboxes.get(review.id);
	if (!sandboxPath) return c.json(files);
	const expanded = await Promise.all(
		files.map(async (file) => {
			const text = await readSandboxFile(sandboxPath, file.path, 400_000);
			if (!text || text.endsWith('…[truncated]')) return file;
			return expandFileDiff(file, text);
		})
	);
	return c.json(expanded);
});

const chatSchema = z.object({ assignmentId: z.string().min(1).max(100), text: z.string().trim().min(1).max(8000) });
app.post('/:id/chat', async (c) => {
	const parsed = chatSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: 'Enter a message of at most 8,000 characters.' }, 400);
	try {
		return c.json(startReviewChat(c.req.param('id'), parsed.data.assignmentId, parsed.data.text), 202);
	} catch (error) {
		if (error instanceof ReviewChatError) return c.json({ error: error.message }, error.status);
		return c.json({ error: 'Configure the model in Connections before sending a message.' }, 409);
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
	const review = db.reviews.get(c.req.param('id'));
	if (!review) return c.json({ error: 'review not found' }, 404);
	const parsed = discussRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
	}
	const diff = reviewDiffs.get(review.id);
	if (!diff) return c.json({ error: 'no diff yet' }, 409);
	try {
		const result = await withReviewMetrics(review.id, 'discussion', () => discussFinding({
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
		}));
		return c.json(result);
	} catch (err) {
		if (err instanceof LlmError) return c.json({ error: err.message }, 502);
		throw err;
	}
});
/** Stream a follow-up reply as server-sent events (`token` chunks, then `done`). */
app.post('/:id/discuss/stream', async (c) => {
	const review = db.reviews.get(c.req.param('id'));
	if (!review) return c.json({ error: 'review not found' }, 404);
	const parsed = discussRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
	}
	const diff = reviewDiffs.get(review.id);
	if (!diff) return c.json({ error: 'no diff yet' }, 409);
	const input = {
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
	};
	const stream = new ReadableStream({
		async start(controller) {
			const send = (data: unknown) => {
				controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
			};
			try {
				const result = await withReviewMetrics(review.id, 'discussion', () => streamDiscussFinding(input, (text) =>
					send({ type: 'token', text })
				));
				send({ type: 'done', ...result });
			} catch (err) {
				send({
					type: 'error',
					error: err instanceof LlmError ? err.message : 'The reviewer did not respond.'
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
	const review = db.reviews.get(c.req.param('id'));
	if (!review) return c.json({ error: 'review not found' }, 404);
	const parsed = rereviewRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
	}
	const diff = reviewDiffs.get(review.id);
	if (!diff) return c.json({ error: 'no diff yet' }, 409);
	try {
		const result = await withReviewMetrics(review.id, 'discussion', () => runRereview({
			notes: parsed.data.notes,
			diff,
			sandboxPath: reviewSandboxes.get(review.id) ?? null,
			existingFindings: review.findings
		}));
		if (result.findings.length > 0) {
			const current = db.reviews.get(review.id);
			if (current) {
				const seen = new Set(current.findings.map((f) => `${f.file}:${f.line ?? ''}:${f.message}`));
				const fresh = result.findings.filter((f) => !seen.has(`${f.file}:${f.line ?? ''}:${f.message}`));
				result.findings = fresh;
				if (fresh.length > 0) {
					db.reviews.set({
						...current,
						findings: [...current.findings, ...fresh],
						updatedAt: new Date().toISOString()
					});
				}
			}
		}
		return c.json(result);
	} catch (err) {
		if (err instanceof LlmError) return c.json({ error: err.message }, 502);
		throw err;
	}
});
/** Suggest a minimal unified-diff fix for one finding (on demand, not stored). */
app.post('/:id/fixes/suggest', async (c) => {
	const review = db.reviews.get(c.req.param('id'));
	if (!review) return c.json({ error: 'review not found' }, 404);
	const parsed = suggestFixRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
	}
	const diff = reviewDiffs.get(review.id);
	if (!diff) return c.json({ error: 'no diff yet' }, 409);
	const sandboxPath = reviewSandboxes.get(review.id) ?? null;
	try {
		const result = await withReviewMetrics(review.id, 'fix', () => suggestFix({
			agent: parsed.data.agent,
			file: parsed.data.finding.file,
			line: parsed.data.finding.line,
			endLine: parsed.data.finding.endLine,
			severity: parsed.data.finding.severity,
			message: parsed.data.finding.message,
			diff,
			sandboxPath
		}));
		const applies = sandboxPath ? await patchApplies(sandboxPath, result.patch) : null;
		return c.json({ ...result, applies });
	} catch (err) {
		if (err instanceof LlmError) return c.json({ error: err.message }, 502);
		throw err;
	}
});
/**
 * Apply a suggested patch in the review sandbox, commit it, and push to the
 * PR head branch. Fails cleanly (409) when the patch no longer applies.
 */
app.post('/:id/fixes/apply', async (c) => {
	const review = db.reviews.get(c.req.param('id'));
	if (!review) return c.json({ error: 'review not found' }, 404);
	const parsed = applyFixRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
	}
	if (review.source === 'stub') return c.json({ error: 'no checkout for stub reviews' }, 409);
	const sandboxPath = reviewSandboxes.get(review.id);
	if (!sandboxPath) return c.json({ error: 'no checkout yet' }, 409);
	const repo = db.repos.get(review.repoId);
	if (!repo) return c.json({ error: 'repo is no longer tracked' }, 409);
	try {
		const headRef =
			review.source === 'gitlab'
				? await fetchMergeHeadRef(repo.url, review.prNumber)
				: await fetchPullHeadRef(repo.url, review.prNumber);
		const { sha } = await applyFixCommit({
			sandboxPath,
			patch: parsed.data.patch,
			summary: parsed.data.summary,
			file: parsed.data.finding.file,
			line: parsed.data.finding.line,
			message: parsed.data.finding.message
		});
		try {
			await pushFixBranch({
				sandboxPath,
				localBranch: refspecFor(review.source, review.prNumber).branch,
				headRef
			});
		} catch (err) {
			if (err instanceof FixError) {
				return c.json({ error: err.message, sha, pushed: false }, 502);
			}
			throw err;
		}
		return c.json({ sha, branch: headRef, pushed: true });
	} catch (err) {
		if (err instanceof FixError) return c.json({ error: err.message }, err.status);
		if (err instanceof GhError) return c.json({ error: err.message }, 502);
		throw err;
	}
});
/** Live pipeline events (fetch/sandbox/agent progress) as server-sent events. */
app.get('/:id/events', (c) => {
	const review = db.reviews.get(c.req.param('id'));
	if (!review) return c.json({ error: 'review not found' }, 404);
	const encoder = new TextEncoder();
	let unsubscribe: (() => void) | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	const cleanup = () => {
		unsubscribe?.();
		if (heartbeat) clearInterval(heartbeat);
		c.req.raw.signal.removeEventListener('abort', cleanup);
	};
	const stream = new ReadableStream({
		start(controller) {
			const send = (data: unknown) => {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
				} catch {
					// Client went away.
					cleanup();
				}
			};
			const snapshot = reviewProgress.get(review.id) ?? emptyReviewProgress(review.id);
			send({ type: 'snapshot', snapshot, review, status: review.status, sequence: snapshot.sequence });
			unsubscribe = subscribeReview(review.id, (event) => {
				const terminal = !event.step && (event.type === 'done' || event.type === 'error');
				send(terminal ? {
					...event,
					review: db.reviews.get(review.id),
					snapshot: reviewProgress.get(review.id)
				} : event);
			}, false);
			c.req.raw.signal.addEventListener('abort', cleanup, { once: true });
			heartbeat = setInterval(() => {
				try {
					send({ type: 'heartbeat', at: new Date().toISOString(), status: db.reviews.get(review.id)?.status });
				} catch {
					if (heartbeat) clearInterval(heartbeat);
				}
			}, 5000);
		},
		cancel() {
			cleanup();
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
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
