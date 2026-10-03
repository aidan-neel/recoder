import { Hono } from 'hono';
import type { Repo, Review } from '@recoder/shared';
import { fetchChecks } from '../../forge/checks';
import { GhError } from '../../forge/gh';
import { fetchPullHead } from '../../forge/github-rest';
import { fetchMergeHeadRef } from '../../forge/glab';
import { parseSlug } from '../../forge/providers';
import { tokenEnv } from '../../forge/tokens';
import { db } from '../../store';
import { TtlCache } from '../../util/ttl-cache';
import { requireReview } from './shared';

/** Checks poll every 20s while any run, so a 15s cache only saves repeat opens. */
const checksCache = new TtlCache<unknown>(15_000);

const app = new Hono();

/**
 * CI checks for the PR head: GitLab checks run on the MR's source branch,
 * GitHub's on the head commit, whose sha also covers PRs from forks.
 */
async function reviewChecks(review: Review, repo: Repo) {
	const provider = review.source;

	if (review.source === 'gitlab') {
		const ref = await fetchMergeHeadRef(repo.url, review.prNumber, tokenEnv('gitlab', repo.url));

		return { ref, provider, checks: await fetchChecks(repo, ref) };
	}

	const head = await fetchPullHead(parseSlug(repo.url), review.prNumber);

	return { ref: head.ref, provider, checks: await fetchChecks(repo, head.sha) };
}

/** CI checks for the PR head. */
app.get('/:id/checks', async (c) => {
	const review = requireReview(c);

	if (review instanceof Response) return review;

	const repo = db.repos.get(review.repoId);

	if (!repo || review.source === 'stub') return c.json({ error: 'checks are unavailable for this review' }, 409);

	try {
		return c.json(await checksCache.get(review.id, () => reviewChecks(review, repo)));
	} catch (err) {
		if (err instanceof GhError) return c.json({ error: err.message }, 502);
		throw err;
	}
});

export default app;
