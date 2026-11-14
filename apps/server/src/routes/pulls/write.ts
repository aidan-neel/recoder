import { Hono } from 'hono';
import { z } from 'zod';
import { PULL_MERGE_METHODS, type PullStatus } from '@recoder/shared';
import { forgetPull, freshPullEntry, mergeMethods, pullEntry, pullForge } from '../../forge/pulls/cached';
import { recordPullState } from '../../forge/pulls/pull-states';
import { PullHeadMoved } from '../../forge/pulls/status';
import { parseBody } from '../parse-body';
import { trustedOrigin } from '../trusted-origin';
import { pullRoute } from './shared';

/** GitHub's limit on a comment body, the lower of the two forges'. */
const COMMENT_MAX_CHARS = 65_536;

const commentSchema = z.object({ body: z.string().trim().min(1).max(COMMENT_MAX_CHARS) });

const mergeSchema = z.object({
	method: z.enum(PULL_MERGE_METHODS),
	headSha: z.string().regex(/^[0-9a-f]{7,64}$/i, 'a commit SHA')
});

const app = new Hono();

/** Comment on the pull request's conversation, when its forge keeps one (the page's `comments` capability). */
app.post(
	'/:id/pulls/:pr/comments',
	trustedOrigin,
	pullRoute(async (c, { repo, n }) => {
		const forge = pullForge(repo);

		if (!forge.comments) return c.json({ error: 'This repository has no conversation to comment on.' }, 400);

		const input = await parseBody(c, commentSchema);

		if (input instanceof Response) return input;

		const { pull } = await pullEntry(repo, n);
		const comment = await forge.comment(pull, input.body);

		forgetPull(repo, n);

		return c.json(comment, 201);
	})
);

/**
 * Merge the pull request with one of the repository's methods (the page's
 * `mergeMethods` capability), only at the head the person saw, and only while
 * it is open and ready. The forge's branch rules still decide; a refusal
 * answers `merged: false` with its reason. A head that moved, before the
 * check or between it and the merge, answers 409.
 */
app.post(
	'/:id/pulls/:pr/merge',
	trustedOrigin,
	pullRoute(async (c, { repo, n }) => {
		const input = await parseBody(c, mergeSchema);

		if (input instanceof Response) return input;

		const methods = await mergeMethods(repo);

		if (methods.length === 0) return c.json({ error: 'Recoder can’t merge pull requests in this repository.' }, 400);

		if (!methods.includes(input.method)) {
			return c.json({ error: `This repository doesn’t allow ${input.method} merges.` }, 400);
		}

		const { pull, status } = await freshPullEntry(repo, n);
		const blocker = mergeBlocker(status);

		if (blocker) return c.json({ error: blocker }, 409);
		if (pull.headSha !== input.headSha) throw new PullHeadMoved();

		const result = await pullForge(repo).merge(n, input);

		forgetPull(repo, n);
		if (result.merged) await recordPullState(repo.id, n, 'merged');

		return c.json(result);
	})
);

/** Why the pull request's state stops a merge, or null when it can be tried. */
function mergeBlocker(status: PullStatus): string | null {
	if (status.state !== 'open') return `The pull request is ${status.state}, so it can’t be merged.`;
	if (status.draft) return 'The pull request is a draft. Mark it ready for review before merging.';

	return null;
}

export default app;
