import { Hono } from 'hono';
import type { PullPage } from '@recoder/shared';
import {
	mergeMethods,
	pullChecks,
	pullCommits,
	pullConversation,
	pullDiff,
	pullEntryStale,
	pullForge,
	pullHead
} from '../../forge/pulls/cached';
import { newestReviews } from '../../forge/pulls/list';
import { detectProvider } from '../../forge/providers';
import { db } from '../../store';
import { pullRoute } from './shared';
import writes from './write';

const app = new Hono();

/** How old the page's pull request read may be and still answer at once; mergeability and checks poll anyway. */
const PAGE_STALE_MS = 60_000;

/** What the pull request page shows before its tabs load. Answers for a merged or closed pull request too. */
app.get(
	'/:id/pulls/:pr/page',
	pullRoute(async (c, { repo, n }) => {
		const forge = pullForge(repo);

		const [entry, methods, reviews] = await Promise.all([
			pullEntryStale(repo, n, PAGE_STALE_MS),
			mergeMethods(repo),
			db.reviews.list()
		]);

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
		const head = await pullHead(repo, n);

		c.header('Cache-Control', 'private, no-cache');

		if (etagMatches(c.req.header('if-none-match'), head)) {
			c.header('ETag', `"${head}"`);

			return c.body(null, 304);
		}

		const diff = await pullDiff(repo, n, head);

		c.header('ETag', `"${diff.headSha}"`);

		return c.json(diff);
	})
);

app.get(
	'/:id/pulls/:pr/commits',
	pullRoute(async (c, { repo, n }) => {
		const { pull } = await pullEntryStale(repo, n, PAGE_STALE_MS);

		return c.json(await pullCommits(repo, pull));
	})
);

/** The head commit's CI checks; a local repository has none. */
app.get(
	'/:id/pulls/:pr/checks',
	pullRoute(async (c, { repo, n }) => {
		const { pull } = await pullEntryStale(repo, n, PAGE_STALE_MS);

		return c.json(await pullChecks(repo, pull));
	})
);

app.get(
	'/:id/pulls/:pr/comments',
	pullRoute(async (c, { repo, n }) => {
		const { pull } = await pullEntryStale(repo, n, PAGE_STALE_MS);

		return c.json(await pullConversation(repo, pull));
	})
);

app.route('/', writes);

/** Whether an `If-None-Match` header names `headSha`'s ETag, in a list or as a weak tag. */
function etagMatches(header: string | undefined, headSha: string): boolean {
	if (!header) return false;

	return header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === `"${headSha}"`);
}

export default app;
