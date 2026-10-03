import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { failureExcerpt, fetchCheckLog } from '../../forge/checks';
import { GhError } from '../../forge/gh';
import { withReviewMetrics } from '../../models/metrics';
import { LlmError } from '../../models/llm';
import { configForRole } from '../../models/models';
import { resolveDiscussRole } from '../../review/chat/discuss';
import { markFindingFixed } from '../../review/fixes/finding-fixes';
import {
	applyFixRequestSchema,
	applyFixToWorktree,
	deleteVerifyBranch,
	patchApplies,
	pushVerifyBranch,
	suggestCheckFix,
	suggestFix,
	suggestFixRequestSchema,
	VERIFY_BRANCH_PREFIX,
	withSandboxLock
} from '../../review/fixes/fix';
import { CheckoutError, ensureReviewCheckout } from '../../review/session/review-checkout';
import { db, reviewDiffs } from '../../store';
import {
	fixFailure,
	fixModelFailure,
	forgeFailure,
	requireReview,
	reviewHeadRef,
	reviewWithBody,
	reviewWithDiff
} from './shared';

const checkFixSchema = z.object({ id: z.string().regex(/^\d+$/).max(30), name: z.string().min(1).max(300) });

const verifyFixSchema = applyFixRequestSchema.extend({ key: z.string().trim().min(1).max(80) });

const app = new Hono();

/** A checkout that could not be made, as its status with a note that fixes need one. */
function checkoutFailure(c: Context, err: unknown): Response | undefined {
	if (err instanceof CheckoutError)
		return c.json({ error: `Fixes need a local checkout of the pull request. ${err.message}` }, err.status);

	return undefined;
}

/** The temporary branch a fix is pushed to for CI: the PR number and a slug of the fix's key. */
function verifyBranchName(prNumber: number, key: string): string {
	const slug = key
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 24);

	return `${VERIFY_BRANCH_PREFIX}${prNumber}-${slug}`;
}

/**
 * Suggest a minimal unified-diff fix for one finding (on demand, not stored).
 * A missing model is reported first, before any checkout work.
 */
app.post('/:id/fixes/suggest', async (c) => {
	const loaded = await reviewWithDiff(c, suggestFixRequestSchema);

	if (loaded instanceof Response) return loaded;

	const { review, body, diff } = loaded;
	const role = resolveDiscussRole(body.agent);

	configForRole(role);

	let sandboxPath: string;

	try {
		sandboxPath = await ensureReviewCheckout(review);
	} catch (err) {
		const failure = checkoutFailure(c, err);

		if (failure) return failure;
		throw err;
	}

	try {
		const result = await withReviewMetrics(review.id, 'fix', () =>
			suggestFix({ agent: body.agent, ...body.finding, diff, sandboxPath })
		);

		const applies = await patchApplies(sandboxPath, result.patch);

		return c.json({ ...result, applies });
	} catch (err) {
		if (err instanceof LlmError) return fixModelFailure(c, err, configForRole(role));

		throw err;
	}
});

/** Suggest a fix for a failing CI check from its log (same shape as a finding's fix). */
app.post('/:id/checks/fix', async (c) => {
	const loaded = await reviewWithBody(c, checkFixSchema);

	if (loaded instanceof Response) return loaded;

	const { review, body } = loaded;
	const repo = db.repos.get(review.repoId);

	if (!repo || review.source === 'stub') return c.json({ error: 'checks are unavailable for this review' }, 409);

	const diff = reviewDiffs.get(review.id);

	if (!diff) return c.json({ error: 'no diff yet' }, 409);
	configForRole('correctness');

	try {
		const [log, sandboxPath] = await Promise.all([fetchCheckLog(repo, body.id), ensureReviewCheckout(review)]);
		const excerpt = failureExcerpt(log);

		if (!excerpt) return c.json({ error: 'This check has no log to work from.' }, 409);

		const result = await withReviewMetrics(review.id, 'fix', () =>
			suggestCheckFix({ check: body.name, log: excerpt, diff, sandboxPath })
		);

		return c.json({ ...result, applies: await patchApplies(sandboxPath, result.patch) });
	} catch (err) {
		const failure = checkoutFailure(c, err);

		if (failure) return failure;
		if (err instanceof GhError) return c.json({ error: `Couldn't read the check's log: ${err.message}` }, 502);
		if (err instanceof LlmError) return fixModelFailure(c, err, configForRole('correctness'));

		throw err;
	}
});

/**
 * Apply a suggested patch to the review checkout's working tree. Committing
 * and pushing are separate, explicit steps (`/changes`), so the finding records
 * the fix with no commit sha yet. Fails cleanly (409) when the patch no longer applies.
 */
app.post('/:id/fixes/apply', async (c) => {
	const loaded = await reviewWithBody(c, applyFixRequestSchema);

	if (loaded instanceof Response) return loaded;

	const { review, body } = loaded;

	if (review.source === 'stub') return c.json({ error: 'no checkout for stub reviews' }, 409);

	const repo = db.repos.get(review.repoId);

	if (!repo) return c.json({ error: 'repo is no longer tracked' }, 409);

	try {
		const headRef = await reviewHeadRef(review, repo.url);
		const sandboxPath = await ensureReviewCheckout(review);

		return await withSandboxLock(sandboxPath, async () => {
			const { paths } = await applyFixToWorktree({ sandboxPath, patch: body.patch, edits: body.edits });

			if (body.findingId) {
				markFindingFixed(review.id, body.findingId, {
					sha: '',
					branch: headRef,
					summary: body.summary,
					at: new Date().toISOString(),
					...(body.agent ? { agent: body.agent } : {})
				});
			}

			return c.json({ files: paths, branch: headRef });
		});
	} catch (err) {
		const failure = forgeFailure(c, err);

		if (failure) return failure;
		throw err;
	}
});

/** Push a fix to a temporary `recoder/fix-…` branch so CI can run on it; the PR branch is untouched. */
app.post('/:id/fixes/verify', async (c) => {
	const loaded = await reviewWithBody(c, verifyFixSchema);

	if (loaded instanceof Response) return loaded;

	const { review, body } = loaded;

	if (review.source === 'stub') return c.json({ error: 'no checkout for stub reviews' }, 409);

	const branch = verifyBranchName(review.prNumber, body.key);

	try {
		const sandboxPath = await ensureReviewCheckout(review);

		const { sha } = await withSandboxLock(sandboxPath, () =>
			pushVerifyBranch({
				sandboxPath,
				branch,
				patch: body.patch,
				edits: body.edits,
				summary: body.summary,
				file: body.finding.file,
				line: body.finding.line,
				message: body.finding.message
			})
		);

		return c.json({ branch, sha });
	} catch (err) {
		const failure = fixFailure(c, err);

		if (failure) return failure;
		throw err;
	}
});

app.delete('/:id/fixes/verify', async (c) => {
	const review = requireReview(c);

	if (review instanceof Response) return review;

	const branch = c.req.query('branch') ?? '';

	if (review.source === 'stub') return c.json({ error: 'no checkout for stub reviews' }, 409);

	try {
		const sandboxPath = await ensureReviewCheckout(review);

		await withSandboxLock(sandboxPath, () => deleteVerifyBranch(sandboxPath, branch));

		return c.json({ deleted: true });
	} catch (err) {
		const failure = fixFailure(c, err);

		if (failure) return failure;
		throw err;
	}
});

export default app;
