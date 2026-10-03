import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Review } from '@recoder/shared';
import { withSandboxLock } from '../../review/fixes/fix';
import { findReviewCheckout } from '../../review/session/review-checkout';
import {
	commitPendingChanges,
	discardPendingChanges,
	listPendingChanges,
	pushPendingCommits,
	undoLastCommit
} from '../../review/session/pending-changes';
import { db } from '../../store';
import { forgeFailure, requireReview, reviewHeadRef } from './shared';

const pathsSchema = z.object({ paths: z.array(z.string().min(1).max(500)).min(1).max(500) });
const commitSchema = pathsSchema.extend({ message: z.string().trim().min(1).max(10_000) });

const app = new Hono();

/**
 * The developer's uncommitted files and unpushed commits in the review checkout.
 * Every write below runs only on an explicit request: which files, what
 * message, and when to push are the developer's call.
 *
 * These only use a checkout that already exists: restoring one here would
 * race the pipeline's own clone of the same directory. Reads (`read`) are plain
 * `git status`/`log` and never wait behind a push or fix apply; writes hold the
 * checkout's lock.
 */
async function withChanges(
	c: Context,
	fn: (sandboxPath: string, review: Review) => Promise<Response>,
	read?: { empty: () => Response }
): Promise<Response> {
	const empty = read?.empty;
	const review = requireReview(c);

	if (review instanceof Response) return review;
	if (review.source === 'stub') return empty ? empty() : c.json({ error: 'no checkout for stub reviews' }, 409);

	try {
		const sandboxPath = await findReviewCheckout(review);

		if (!sandboxPath) return empty ? empty() : c.json({ error: 'This review has no checkout yet.' }, 409);

		return read ? await fn(sandboxPath, review) : await withSandboxLock(sandboxPath, () => fn(sandboxPath, review));
	} catch (err) {
		const failure = forgeFailure(c, err);

		if (failure) return failure;
		throw err;
	}
}

app.get('/:id/changes', (c) =>
	withChanges(c, async (sandboxPath) => c.json(await listPendingChanges(sandboxPath)), {
		empty: () => c.json({ files: [], commits: [] })
	})
);

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

export default app;
