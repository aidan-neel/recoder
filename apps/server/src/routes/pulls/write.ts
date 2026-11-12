import { Hono } from 'hono';
import { z } from 'zod';
import { PULL_MERGE_METHODS, type MergePullInput } from '@recoder/shared';
import { detectProvider } from '../../forge/providers';
import { forgetPull, freshPullEntry, mergeMethods, pullEntry, pullForge } from '../../forge/pulls/cached';
import type { PullEntry } from '../../forge/pulls/status';
import { parseBody } from '../parse-body';
import { trustedOrigin } from '../trusted-origin';
import { requirePull, withForge } from './shared';

/** GitHub's limit on a comment body, the lower of the two forges'. */
const COMMENT_MAX_CHARS = 65_536;

const commentSchema = z.object({ body: z.string().trim().min(1).max(COMMENT_MAX_CHARS) });

const mergeSchema = z.object({
	method: z.enum(PULL_MERGE_METHODS),
	headSha: z.string().regex(/^[0-9a-f]{7,64}$/i, 'a commit SHA')
});

const app = new Hono();

/** Comment on the pull request's conversation. */
app.post('/:id/pulls/:pr/comments', trustedOrigin, async (c) => {
	const target = await requirePull(c);

	if (target instanceof Response) return target;

	const { repo, n } = target;
	const forge = pullForge(repo);

	if (!forge.comments) return c.json({ error: 'Local repositories have no conversation to comment on.' }, 400);

	const input = await parseBody(c, commentSchema);

	if (input instanceof Response) return input;

	return withForge(c, async () => {
		const { pull } = await pullEntry(repo, n);
		const comment = await forge.comment(pull, input.body);

		forgetPull(repo, n);

		return c.json(comment, 201);
	});
});

/**
 * Merge the pull request with one of the repository's methods, only at the
 * head the person saw, and only while it is open and ready. The forge's
 * branch rules still decide; a refusal answers `merged: false` with its reason.
 */
app.post('/:id/pulls/:pr/merge', trustedOrigin, async (c) => {
	const target = await requirePull(c);

	if (target instanceof Response) return target;

	const { repo, n } = target;

	if ((repo.provider ?? detectProvider(repo.url)) === 'local') {
		return c.json({ error: 'Local repositories can’t be merged from Recoder.' }, 400);
	}

	const input = await parseBody(c, mergeSchema);

	if (input instanceof Response) return input;

	return withForge(c, async () => {
		if (!(await mergeMethods(repo)).includes(input.method)) {
			return c.json({ error: `This repository doesn’t allow ${input.method} merges.` }, 400);
		}

		const blocker = mergeBlocker(await freshPullEntry(repo, n), input);

		if (blocker) return c.json({ error: blocker }, 409);

		const result = await pullForge(repo).merge(n, input);

		forgetPull(repo, n);

		return c.json(result);
	});
});

/** Why the pull request can't be merged as asked, or null when it can be tried. */
function mergeBlocker({ pull, status }: PullEntry, input: MergePullInput): string | null {
	if (status.state !== 'open') return `The pull request is ${status.state}, so it can’t be merged.`;
	if (status.draft) return 'The pull request is a draft. Mark it ready for review before merging.';
	if (pull.headSha !== input.headSha)
		return 'The pull request has new commits since you loaded it. Reload and try again.';

	return null;
}

export default app;
