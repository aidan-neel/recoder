import { Hono } from 'hono';
import type { PullPage } from '@recoder/shared';
import { fetchChecks } from '../../forge/checks';
import { mergeMethods, pullDiff, pullEntry, pullForge } from '../../forge/pulls/cached';
import { newestReviews } from '../../forge/pulls/list';
import { detectProvider } from '../../forge/providers';
import { db } from '../../store';
import { pullRoute } from './shared';
import writes from './write';

const app = new Hono();

/** What the pull request page shows before its tabs load. Answers for a merged or closed pull request too. */
app.get(
	'/:id/pulls/:pr/page',
	pullRoute(async (c, { repo, n }) => {
		const forge = pullForge(repo);

		const [entry, methods, reviews] = await Promise.all([pullEntry(repo, n), mergeMethods(repo), db.reviews.list()]);

		const page: PullPage = {
			provider: repo.provider ?? detectProvider(repo.url),
			repoId: repo.id,
			pull: entry.pull,
			status: entry.status,
			capabilities: { comments: forge.comments, checks: forge.checks, mergeMethods: methods },
			review: newestReviews(reviews)(repo.id, n)
		};

		return c.json(page);
	})
);

/**
 * The whole diff at the head commit, without a review. The head names the
 * diff, so it is the ETag, and a client that already has it gets a 304.
 */
app.get(
	'/:id/pulls/:pr/diff',
	pullRoute(async (c, { repo, n }) => {
		const { pull } = await pullEntry(repo, n);

		c.header('Cache-Control', 'private, no-cache');

		if (etagMatches(c.req.header('if-none-match'), pull.headSha)) {
			c.header('ETag', `"${pull.headSha}"`);

			return c.body(null, 304);
		}

		const diff = await pullDiff(repo, n, pull.headSha);

		c.header('ETag', `"${diff.headSha}"`);

		return c.json(diff);
	})
);

app.get(
	'/:id/pulls/:pr/commits',
	pullRoute(async (c, { repo, n }) => {
		const { pull } = await pullEntry(repo, n);

		return c.json(await pullForge(repo).commits(pull));
	})
);

/** The head commit's CI checks; a local repository has none. */
app.get(
	'/:id/pulls/:pr/checks',
	pullRoute(async (c, { repo, n }) => {
		const { pull } = await pullEntry(repo, n);

		return c.json(await fetchChecks(repo, pull.headSha));
	})
);

app.get(
	'/:id/pulls/:pr/comments',
	pullRoute(async (c, { repo, n }) => {
		const forge = pullForge(repo);
		const { pull } = await pullEntry(repo, n);

		return c.json(await forge.conversation(pull));
	})
);

app.route('/', writes);

/** Whether an `If-None-Match` header names `headSha`'s ETag, in a list or as a weak tag. */
function etagMatches(header: string | undefined, headSha: string): boolean {
	if (!header) return false;

	return header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === `"${headSha}"`);
}

export default app;
