import { Hono } from 'hono';
import { z } from 'zod';
import { parseUnifiedDiff, type PullPreview, type Repo } from '@recoder/shared';
import { fetchPullRequest, GhError, listPullRequests } from '../lib/gh';
import { fetchMergeRequest, listMergeRequests } from '../lib/glab';
import { detectProvider } from '../lib/providers';
import { tokenEnv } from '../lib/tokens';
import { db } from '../store';

const createRepoSchema = z.object({
	name: z.string().min(1).max(200),
	url: z.string().url().max(2000),
	provider: z.enum(['github', 'gitlab']).default('github'),
	defaultBranch: z.string().min(1).max(200).default('main')
});

const app = new Hono();

app.get('/', (c) => c.json(db.repos.list()));

app.post('/', async (c) => {
	const parsed = createRepoSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
	}
	const now = new Date().toISOString();
	const repo: Repo = { id: crypto.randomUUID(), ...parsed.data, createdAt: now, updatedAt: now };
	return c.json(db.repos.set(repo), 201);
});

app.get('/:id', (c) => {
	const repo = db.repos.get(c.req.param('id'));
	if (!repo) return c.json({ error: 'repo not found' }, 404);
	return c.json(repo);
});

app.delete('/:id', (c) => {
	if (!db.repos.delete(c.req.param('id'))) return c.json({ error: 'repo not found' }, 404);
	return c.json({ deleted: true });
});

/**
 * Open PRs/MRs for a tracked repo via the provider CLI.
 * Cheap metadata only — no sandbox checkout.
 */
app.get('/:id/pulls', async (c) => {
	const repo = db.repos.get(c.req.param('id'));
	if (!repo) return c.json({ error: 'repo not found' }, 404);
	const provider = repo.provider ?? detectProvider(repo.url);
	try {
		const prs =
			provider === 'gitlab'
				? await listMergeRequests(repo.url, { env: tokenEnv('gitlab') })
				: await listPullRequests(repo.url, { env: tokenEnv('github') });
		return c.json(prs);
	} catch (err) {
		if (err instanceof GhError) return c.json({ error: err.message, kind: err.kind }, 502);
		throw err;
	}
});

/**
 * Live PR preview: metadata + per-file stats via the provider CLI.
 * No sandbox checkout — cheap enough to call from the create-session form.
 */
app.get('/:id/pulls/:pr', async (c) => {
	const repo = db.repos.get(c.req.param('id'));
	if (!repo) return c.json({ error: 'repo not found' }, 404);
	const n = Number(c.req.param('pr'));
	if (!Number.isInteger(n) || n <= 0) return c.json({ error: 'invalid PR number' }, 400);
	const provider = repo.provider ?? detectProvider(repo.url);
	try {
		const { pr, diff } =
			provider === 'gitlab'
				? await fetchMergeRequest(repo.url, n, { env: tokenEnv('gitlab') })
				: await fetchPullRequest(repo.url, n, { env: tokenEnv('github') });
		const preview: PullPreview = {
			provider,
			pr,
			files: parseUnifiedDiff(diff).map((f) => ({
				path: f.path,
				additions: f.additions,
				deletions: f.deletions
			}))
		};
		return c.json(preview);
	} catch (err) {
		if (err instanceof GhError) return c.json({ error: err.message, kind: err.kind }, 502);
		throw err;
	}
});

export default app;
