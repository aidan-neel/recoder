import { Hono, type Context } from 'hono';
import { getReviewControl } from '../lib/review-control';
import { emitReviewEvent } from '../lib/events';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { emptyReviewProgress, expandFileDiff, parseUnifiedDiff } from '@recoder/shared';
import type { Review } from '@recoder/shared';
import { createReviewSession, queueReview, continueReviewSession, startReviewSession } from '../commands/pipeline';
import { configForRole, isReviewConfigured, ModelConfigError } from '../lib/models';
import { modelFailure } from '../lib/model-failure';
import { clearReviewEvents, subscribeReview } from '../lib/events';
import { discussFinding, streamDiscussFinding, discussRequestSchema, resolveDiscussRole } from '../lib/discuss';
import { runRereview, rereviewRequestSchema } from '../lib/rereview';
import { readSandboxFile } from '../lib/harness';
import {
	applyFixToWorktree,
	applyFixRequestSchema,
	deleteVerifyBranch,
	FixError,
	pushVerifyBranch,
	VERIFY_BRANCH_PREFIX,
	withSandboxLock,
	patchApplies,
	suggestFix,
	suggestCheckFix,
	suggestFixRequestSchema
} from '../lib/fix';
import { GhError, fetchPullHeadRef } from '../lib/gh';
import { TtlCache } from '../lib/ttl-cache';
import { failureExcerpt, fetchCheckLog, fetchChecks } from '../lib/checks';
import { fetchPullHead } from '../lib/github-rest';
import { fetchMergeHeadRef } from '../lib/glab';
import { tokenEnv } from '../lib/tokens';
import { LlmError } from '../lib/llm';
import { parseSlug } from '../lib/providers';
import { db, reviewDiffs, reviewSandboxes, reviewProgress, reviewMetrics, reviewCheckpoints } from '../store';
import { getReviewMetrics, withReviewMetrics } from '../lib/metrics';
import { CheckoutError, ensureReviewCheckout, findReviewCheckout } from '../lib/review-checkout';
import { markFindingFixed } from '../lib/finding-fixes';
import {
	commitPendingChanges,
	discardPendingChanges,
	listPendingChanges,
	pushPendingCommits,
	undoLastCommit
} from '../lib/pending-changes';
import {
	cancelReviewChats,
	ReviewChatError,
	reviewCodeContextSchema,
	prepareDraftSession,
	startReviewChat,
	stopReviewChat
} from '../lib/review-chat';

const createReviewSchema = z.object({
	repoId: z.string().min(1),
	prNumber: z.number().int().positive(),
	headSha: z.string().min(1).max(100).optional(),
	start: z.boolean().optional(),
	prTitle: z.string().max(500).optional()
});

const app = new Hono();

app.get('/', (c) => c.json(db.reviews.list()));

/** Compact live progress per review, for the home dashboard's recent-session list. */
app.get('/progress-summaries', (c) => {
	const summaries: Record<string, { tasksDone: number; tasksTotal: number; specialists: number }> = {};

	for (const progress of reviewProgress.list()) {
		const tasks = Object.values(progress.tasks ?? {});

		summaries[progress.id] = {
			tasksTotal: tasks.length,
			tasksDone: tasks.filter((task) => task.status === 'done' || task.status === 'skipped' || task.status === 'error')
				.length,
			specialists: (progress.assignments ?? []).filter((assignment) => assignment.status === 'running').length
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
	getReviewControl(review.id)?.cancel();
	db.reviews.delete(review.id);
	cancelReviewChats(review.id);
	reviewDiffs.delete(review.id);
	reviewMetrics.delete(review.id);
	reviewCheckpoints.delete(review.id);
	reviewSandboxes.delete(review.id);
	clearReviewEvents(review.id);

	return c.json({ deleted: true });
});

/** Stop a running review. Findings so far are kept; it can be restarted. */
app.post('/:id/cancel', (c) => {
	const review = db.reviews.get(c.req.param('id'));

	if (!review) return c.json({ error: 'review not found' }, 404);

	const control = getReviewControl(review.id);

	if (!control) return c.json({ error: 'review is not running' }, 409);
	control.cancel();
	cancelReviewChats(review.id);

	return c.json({ cancelled: true });
});

/** Approve a plan waiting for the developer: its specialists run. Declining is a cancel. */
app.post('/:id/approve-plan', (c) => {
	const review = db.reviews.get(c.req.param('id'));

	if (!review) return c.json({ error: 'review not found' }, 404);

	const control = getReviewControl(review.id);

	if (!control?.approve()) return c.json({ error: 'This review is not waiting for approval.' }, 409);

	return c.json({ approved: true });
});

/** Hold a running review: in-flight model calls stop and re-run on resume. */
app.post('/:id/pause', (c) => {
	const review = db.reviews.get(c.req.param('id'));

	if (!review) return c.json({ error: 'review not found' }, 404);

	const control = getReviewControl(review.id);

	if (!control) return c.json({ error: 'review is not running' }, 409);
	if (control.pause())
		emitReviewEvent(review.id, { type: 'step', step: 'review', message: 'Review paused', data: { paused: true } });

	return c.json({ paused: true });
});

app.post('/:id/resume', (c) => {
	const review = db.reviews.get(c.req.param('id'));

	if (!review) return c.json({ error: 'review not found' }, 404);

	const control = getReviewControl(review.id);

	if (!control) return c.json({ error: 'review is not running' }, 409);
	if (control.resume())
		emitReviewEvent(review.id, { type: 'step', step: 'review', message: 'Review resumed', data: { paused: false } });

	return c.json({ paused: false });
});

/**
 * Expanded diffs, briefly: the page polls while a review runs, and re-reading
 * every changed file each time is the slow part. Short enough that fixes
 * written to the checkout show up within seconds.
 */
const filesCache = new TtlCache<{ body: string; etag: string }>(10_000, 50);

/** Parsed unified diff for a review (404 until the fetch step stores one), with an ETag so polls get 304. */
app.get('/:id/files', async (c) => {
	const review = db.reviews.get(c.req.param('id'));

	if (!review) return c.json({ error: 'review not found' }, 404);

	const diff = reviewDiffs.get(review.id);

	if (!diff) return c.json({ error: 'no diff yet' }, 404);

	const sandboxPath = await findReviewCheckout(review);

	const { body, etag } = await filesCache.get(
		`${review.id}:${review.headSha}:${sandboxPath ?? ''}:${Bun.hash(diff)}`,
		async () => {
			const files = parseUnifiedDiff(diff);

			const expanded = !sandboxPath
				? files
				: await Promise.all(
						files.map(async (file) => {
							const text = await readSandboxFile(sandboxPath, file.path, 400_000);

							if (!text || text.endsWith('…[truncated]')) return file;

							return expandFileDiff(file, text);
						})
					);

			const body = JSON.stringify(expanded);

			return { body, etag: `"${Bun.hash(body).toString(36)}"` };
		}
	);

	c.header('ETag', etag);
	c.header('Cache-Control', 'private, no-cache');
	if (c.req.header('if-none-match') === etag) return c.body(null, 304);

	return c.body(body, 200, { 'content-type': 'application/json; charset=utf-8' });
});

/** Start a draft (interactive) review directly, without going through the orchestrator chat. */
app.post('/:id/start', (c) => {
	try {
		return c.json(startReviewSession(c.req.param('id')), 202);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Could not start the review.';

		return c.json({ error: message }, message === 'review not found' ? 404 : 409);
	}
});

/** Continue a failed review from its last checkpoint. */
app.post('/:id/continue', (c) => {
	try {
		return c.json(continueReviewSession(c.req.param('id')), 202);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Could not continue the review.';

		return c.json({ error: message }, message === 'review not found' ? 404 : 409);
	}
});

const chatSchema = z.object({
	assignmentId: z.string().min(1).max(100),
	text: z.string().trim().min(1).max(8000),
	codeContext: reviewCodeContextSchema.optional()
});

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
	const review = db.reviews.get(c.req.param('id'));

	if (!review) return c.json({ error: 'review not found' }, 404);

	const parsed = discussRequestSchema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) {
		return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
	}

	const diff = reviewDiffs.get(review.id);

	if (!diff) return c.json({ error: 'no diff yet' }, 409);

	const sandboxPath = await findReviewCheckout(review);

	try {
		const result = await withReviewMetrics(review.id, 'discussion', () =>
			discussFinding({
				agent: parsed.data.agent,
				file: parsed.data.finding.file,
				line: parsed.data.finding.line,
				endLine: parsed.data.finding.endLine,
				severity: parsed.data.finding.severity,
				message: parsed.data.finding.message,
				history: parsed.data.history,
				question: parsed.data.question,
				diff,
				sandboxPath
			})
		);

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
		sandboxPath: await findReviewCheckout(review)
	};

	const stream = new ReadableStream({
		async start(controller) {
			const send = (data: unknown) => {
				controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
			};

			try {
				const result = await withReviewMetrics(review.id, 'discussion', () =>
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
	const review = db.reviews.get(c.req.param('id'));

	if (!review) return c.json({ error: 'review not found' }, 404);

	const parsed = rereviewRequestSchema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) {
		return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
	}

	const diff = reviewDiffs.get(review.id);

	if (!diff) return c.json({ error: 'no diff yet' }, 409);

	const sandboxPath = await findReviewCheckout(review);

	try {
		const result = await withReviewMetrics(review.id, 'discussion', () =>
			runRereview({
				notes: parsed.data.notes,
				diff,
				sandboxPath,
				existingFindings: review.findings
			})
		);

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
	// A missing model is the first thing to say, before any checkout work.
	configForRole(resolveDiscussRole(parsed.data.agent));

	let sandboxPath: string;

	try {
		sandboxPath = await ensureReviewCheckout(review);
	} catch (err) {
		if (err instanceof CheckoutError)
			return c.json({ error: `Fixes need a local checkout of the pull request. ${err.message}` }, err.status);
		throw err;
	}

	try {
		const result = await withReviewMetrics(review.id, 'fix', () =>
			suggestFix({
				agent: parsed.data.agent,
				file: parsed.data.finding.file,
				line: parsed.data.finding.line,
				endLine: parsed.data.finding.endLine,
				severity: parsed.data.finding.severity,
				message: parsed.data.finding.message,
				diff,
				sandboxPath
			})
		);

		const applies = await patchApplies(sandboxPath, result.patch);

		return c.json({ ...result, applies });
	} catch (err) {
		if (err instanceof LlmError) {
			const failure = modelFailure(
				err,
				configForRole(resolveDiscussRole(parsed.data.agent)),
				'The model could not write a fix. Try again.'
			);

			return c.json(
				{
					error: failure.reason,
					...(failure.signIn ? { action: 'sign-in' } : {}),
					...(failure.usageLimit ? { usageLimit: failure.usageLimit } : {})
				},
				502
			);
		}

		throw err;
	}
});

const checkFixSchema = z.object({ id: z.string().regex(/^\d+$/).max(30), name: z.string().min(1).max(300) });

/** Suggest a fix for a failing CI check from its log (same shape as a finding's fix). */
app.post('/:id/checks/fix', async (c) => {
	const review = db.reviews.get(c.req.param('id'));

	if (!review) return c.json({ error: 'review not found' }, 404);

	const parsed = checkFixSchema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);

	const repo = db.repos.get(review.repoId);

	if (!repo || review.source === 'stub') return c.json({ error: 'checks are unavailable for this review' }, 409);

	const diff = reviewDiffs.get(review.id);

	if (!diff) return c.json({ error: 'no diff yet' }, 409);
	configForRole('correctness');

	try {
		const [log, sandboxPath] = await Promise.all([fetchCheckLog(repo, parsed.data.id), ensureReviewCheckout(review)]);
		const excerpt = failureExcerpt(log);

		if (!excerpt) return c.json({ error: 'This check has no log to work from.' }, 409);

		const result = await withReviewMetrics(review.id, 'fix', () =>
			suggestCheckFix({ check: parsed.data.name, log: excerpt, diff, sandboxPath })
		);

		return c.json({ ...result, applies: await patchApplies(sandboxPath, result.patch) });
	} catch (err) {
		if (err instanceof CheckoutError)
			return c.json({ error: `Fixes need a local checkout of the pull request. ${err.message}` }, err.status);
		if (err instanceof GhError) return c.json({ error: `Couldn't read the check's log: ${err.message}` }, 502);

		if (err instanceof LlmError) {
			const failure = modelFailure(err, configForRole('correctness'), 'The model could not write a fix. Try again.');

			return c.json(
				{
					error: failure.reason,
					...(failure.signIn ? { action: 'sign-in' } : {}),
					...(failure.usageLimit ? { usageLimit: failure.usageLimit } : {})
				},
				502
			);
		}

		throw err;
	}
});

/**
 * Apply a suggested patch to the review checkout's working tree. Committing
 * and pushing are separate, explicit steps (`/changes`). Fails cleanly (409)
 * when the patch no longer applies.
 */
app.post('/:id/fixes/apply', async (c) => {
	const review = db.reviews.get(c.req.param('id'));

	if (!review) return c.json({ error: 'review not found' }, 404);

	const parsed = applyFixRequestSchema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) {
		return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
	}

	if (review.source === 'stub') return c.json({ error: 'no checkout for stub reviews' }, 409);

	const repo = db.repos.get(review.repoId);

	if (!repo) return c.json({ error: 'repo is no longer tracked' }, 409);

	try {
		const headRef = await reviewHeadRef(review, repo.url);
		const sandboxPath = await ensureReviewCheckout(review);

		return await withSandboxLock(sandboxPath, async () => {
			const { paths } = await applyFixToWorktree({ sandboxPath, patch: parsed.data.patch, edits: parsed.data.edits });

			if (parsed.data.findingId) {
				// No commit yet: the fix records what was applied; the Changes panel commits it.
				markFindingFixed(review.id, parsed.data.findingId, {
					sha: '',
					branch: headRef,
					summary: parsed.data.summary,
					at: new Date().toISOString(),
					...(parsed.data.agent ? { agent: parsed.data.agent } : {})
				});
			}

			return c.json({ files: paths, branch: headRef });
		});
	} catch (err) {
		if (err instanceof FixError || err instanceof CheckoutError) return c.json({ error: err.message }, err.status);
		if (err instanceof GhError) return c.json({ error: err.message }, 502);
		throw err;
	}
});

async function reviewHeadRef(review: Review, repoUrl: string): Promise<string> {
	return review.source === 'gitlab'
		? fetchMergeHeadRef(repoUrl, review.prNumber, tokenEnv('gitlab', repoUrl))
		: fetchPullHeadRef(repoUrl, review.prNumber);
}

/**
 * The developer's uncommitted files and unpushed commits in the review checkout.
 * Every write below runs only on an explicit request: which files, what
 * message, and when to push are the developer's call.
 *
 * These only use a checkout that already exists: restoring one here would
 * race the pipeline's own clone of the same directory.
 */
async function withChanges(
	c: Context,
	fn: (sandboxPath: string, review: Review) => Promise<Response>,
	read?: { empty: () => Response }
): Promise<Response> {
	const empty = read?.empty;
	const review = db.reviews.get(c.req.param('id') ?? '');

	if (!review) return c.json({ error: 'review not found' }, 404);
	if (review.source === 'stub') return empty ? empty() : c.json({ error: 'no checkout for stub reviews' }, 409);

	try {
		const sandboxPath = await findReviewCheckout(review);

		if (!sandboxPath) return empty ? empty() : c.json({ error: 'This review has no checkout yet.' }, 409);

		// Reads are plain `git status`/`log`; they never wait behind a push or fix apply.
		return read ? await fn(sandboxPath, review) : await withSandboxLock(sandboxPath, () => fn(sandboxPath, review));
	} catch (err) {
		if (err instanceof FixError || err instanceof CheckoutError) return c.json({ error: err.message }, err.status);
		if (err instanceof GhError) return c.json({ error: err.message }, 502);
		throw err;
	}
}

app.get('/:id/changes', (c) =>
	withChanges(c, async (sandboxPath) => c.json(await listPendingChanges(sandboxPath)), {
		empty: () => c.json({ files: [], commits: [] })
	})
);

const pathsSchema = z.object({ paths: z.array(z.string().min(1).max(500)).min(1).max(500) });
const commitSchema = pathsSchema.extend({ message: z.string().trim().min(1).max(10_000) });

app.post('/:id/changes/commit', async (c) => {
	const parsed = commitSchema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) return c.json({ error: 'Choose the files to commit and write a commit message.' }, 400);

	return withChanges(c, async (sandboxPath) =>
		c.json(await commitPendingChanges(sandboxPath, parsed.data.paths, parsed.data.message))
	);
});

app.post('/:id/changes/discard', async (c) => {
	const parsed = pathsSchema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) return c.json({ error: 'Choose the files to discard.' }, 400);

	return withChanges(c, async (sandboxPath) => {
		await discardPendingChanges(sandboxPath, parsed.data.paths);

		return c.json({ ok: true });
	});
});

app.post('/:id/changes/undo-commit', (c) =>
	withChanges(c, async (sandboxPath) => {
		await undoLastCommit(sandboxPath);

		return c.json({ ok: true });
	})
);

app.post('/:id/changes/push', (c) =>
	withChanges(c, async (sandboxPath, review) => {
		const repo = db.repos.get(review.repoId);

		if (!repo) return c.json({ error: 'repo is no longer tracked' }, 409);

		const headRef = await reviewHeadRef(review, repo.url);

		return c.json({ ...(await pushPendingCommits(sandboxPath, headRef)), branch: headRef });
	})
);

const checksCache = new TtlCache<unknown>(15_000);

/** CI checks for the PR head (default) or any branch/sha of this repo (e.g. a fix's verify branch). */
app.get('/:id/checks', async (c) => {
	const review = db.reviews.get(c.req.param('id'));

	if (!review) return c.json({ error: 'review not found' }, 404);

	const repo = db.repos.get(review.repoId);

	if (!repo || review.source === 'stub') return c.json({ error: 'checks are unavailable for this review' }, 409);

	try {
		const requested = c.req.query('ref');
		const provider = review.source;

		// Checks poll every 20s while any run, so a 15s cache only saves repeat opens.
		return c.json(
			await checksCache.get(`${review.id}|${requested ?? ''}`, async () => {
				if (requested) return { ref: requested, provider, checks: await fetchChecks(repo, requested) };

				if (review.source === 'gitlab') {
					const ref = await fetchMergeHeadRef(repo.url, review.prNumber, tokenEnv('gitlab', repo.url));

					return { ref, provider, checks: await fetchChecks(repo, ref) };
				}

				// Checks run on the head commit; its sha also covers PRs from forks.
				const head = await fetchPullHead(parseSlug(repo.url), review.prNumber);

				return { ref: head.ref, provider, checks: await fetchChecks(repo, head.sha) };
			})
		);
	} catch (err) {
		if (err instanceof GhError) return c.json({ error: err.message }, 502);
		throw err;
	}
});

const verifyFixSchema = applyFixRequestSchema.extend({ key: z.string().trim().min(1).max(80) });

/** Push a fix to a temporary `recoder/fix-…` branch so CI can run on it; the PR branch is untouched. */
app.post('/:id/fixes/verify', async (c) => {
	const review = db.reviews.get(c.req.param('id'));

	if (!review) return c.json({ error: 'review not found' }, 404);

	const parsed = verifyFixSchema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
	if (review.source === 'stub') return c.json({ error: 'no checkout for stub reviews' }, 409);

	const branch = `${VERIFY_BRANCH_PREFIX}${review.prNumber}-${parsed.data.key
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 24)}`;

	try {
		const sandboxPath = await ensureReviewCheckout(review);

		const { sha } = await withSandboxLock(sandboxPath, () =>
			pushVerifyBranch({
				sandboxPath,
				branch,
				patch: parsed.data.patch,
				edits: parsed.data.edits,
				summary: parsed.data.summary,
				file: parsed.data.finding.file,
				line: parsed.data.finding.line,
				message: parsed.data.finding.message
			})
		);

		return c.json({ branch, sha });
	} catch (err) {
		if (err instanceof FixError || err instanceof CheckoutError) return c.json({ error: err.message }, err.status);
		throw err;
	}
});

app.delete('/:id/fixes/verify', async (c) => {
	const review = db.reviews.get(c.req.param('id'));

	if (!review) return c.json({ error: 'review not found' }, 404);

	const branch = c.req.query('branch') ?? '';

	if (review.source === 'stub') return c.json({ error: 'no checkout for stub reviews' }, 409);

	try {
		const sandboxPath = await ensureReviewCheckout(review);

		await withSandboxLock(sandboxPath, () => deleteVerifyBranch(sandboxPath, branch));

		return c.json({ deleted: true });
	} catch (err) {
		if (err instanceof FixError || err instanceof CheckoutError) return c.json({ error: err.message }, err.status);
		throw err;
	}
});

/** Live pipeline events (fetch/sandbox/agent progress) as server-sent events. */
app.get('/:id/events', (c) => {
	const review = db.reviews.get(c.req.param('id'));

	if (!review) return c.json({ error: 'review not found' }, 404);
	c.header('X-Accel-Buffering', 'no');

	const response = streamSSE(c, async (stream) => {
		let lastStatus = review.status;
		let writes = Promise.resolve();

		const send = (data: unknown) => {
			const encoded = JSON.stringify(data);

			writes = writes.then(async () => {
				if (!stream.aborted) await stream.writeSSE({ data: encoded });
			});

			return writes;
		};

		const snapshot = reviewProgress.get(review.id) ?? emptyReviewProgress(review.id);
		const initial = send({ type: 'snapshot', snapshot, review, status: review.status, sequence: snapshot.sequence });

		// Subscribe before awaiting the first write so no update can fall between
		// the snapshot and live events. Serialize all writes through the same queue.
		const unsubscribe = subscribeReview(
			review.id,
			(event) => {
				const terminal = !event.step && (event.type === 'done' || event.type === 'error');
				const current = db.reviews.get(review.id);
				const statusChanged = current?.status !== lastStatus;

				if (current) lastStatus = current.status;

				void send(
					terminal || statusChanged
						? {
								...event,
								review: current,
								...(terminal ? { snapshot: reviewProgress.get(review.id) } : {})
							}
						: event
				);
			},
			false
		);

		let wake: (() => void) | undefined;

		stream.onAbort(() => {
			unsubscribe();
			wake?.();
		});

		try {
			await initial;

			while (!stream.aborted) {
				await new Promise<void>((resolve) => {
					const timer = setTimeout(resolve, 5000);

					wake = () => {
						clearTimeout(timer);
						resolve();
					};
				});

				// Read the stored status: restart recovery can fail a review without emitting an event.
				if (!stream.aborted)
					await send({
						type: 'heartbeat',
						at: new Date().toISOString(),
						status: db.reviews.get(review.id)?.status ?? lastStatus
					});
			}
		} finally {
			unsubscribe();
			wake?.();
		}
	});

	response.headers.set('Cache-Control', 'no-cache, no-transform');

	return response;
});

app.post('/', async (c) => {
	const parsed = createReviewSchema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) {
		return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
	}

	try {
		if (parsed.data.start !== false) return c.json(queueReview(parsed.data), 201);

		const review = createReviewSession(parsed.data);

		void prepareDraftSession(review.id, isReviewConfigured());

		return c.json(review, 201);
	} catch (err) {
		return c.json({ error: err instanceof Error ? err.message : 'invalid input' }, 400);
	}
});

export default app;
