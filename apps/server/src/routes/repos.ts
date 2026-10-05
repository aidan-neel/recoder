import { Hono } from 'hono';
import { z } from 'zod';
import type { Repo } from '@recoder/shared';
import { GhError, listPullRequests } from '../forge/gh';
import { listMergeRequests } from '../forge/glab';
import { listLocalPulls } from '../forge/local/pulls';
import { localGitDir } from '../forge/local/schema';
import { detectProvider } from '../forge/providers';
import { fetchPullPreview } from '../forge/pull-preview';
import { tokenEnv } from '../forge/tokens';
import { TtlCache } from '../util/ttl-cache';
import { db } from '../store';
import { parseBody } from './parse-body';

const pullsCache = new TtlCache<unknown>(30_000);
const previewCache = new TtlCache<unknown>(60_000);

/** A local repo is a `file://` URL, and only a local repo may be one. */
const createRepoSchema = z
	.object({
		name: z.string().min(1).max(200),
		url: z.string().url().max(2000),
		provider: z.enum(['github', 'gitlab', 'local']).default('github'),
		defaultBranch: z.string().min(1).max(200).default('main')
	})
	.refine((body) => (body.provider === 'local') === /^file:\/\//i.test(body.url), {
		message: 'Local repos need a file:// URL, and a file:// URL needs provider "local"',
		path: ['url']
	});

const app = new Hono();

app.get('/', (c) => c.json(db.repos.list()));

app.post('/', async (c) => {
	const body = await parseBody(c, createRepoSchema);

	if (body instanceof Response) return body;

	if (body.provider === 'local' && !(await localGitDir(body.url).catch(() => null))) {
		return c.json({ error: `${body.url} is not a git repository` }, 400);
	}

	const now = new Date().toISOString();
	const repo: Repo = { id: crypto.randomUUID(), ...body, createdAt: now, updatedAt: now };

	return c.json(db.repos.set(repo), 201);
});

app.get('/:id', (c) => {
	const repo = db.repos.get(c.req.param('id'));

	if (!repo) return c.json({ error: 'repo not found' }, 404);

	return c.json(repo);
});

app.delete('/:id', (c) => {
	const id = c.req.param('id');

	if (!db.repos.delete(id)) return c.json({ error: 'repo not found' }, 404);
	pullsCache.delete(id);
	previewCache.delete(`${id}#`);

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
		const prs = await pullsCache.get(repo.id, () =>
			provider === 'local'
				? listLocalPulls(repo.url)
				: provider === 'gitlab'
					? listMergeRequests(repo.url, { env: tokenEnv('gitlab', repo.url) })
					: listPullRequests(repo.url, { env: tokenEnv('github') })
		);

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

	try {
		return c.json(await previewCache.get(`${repo.id}#${n}`, () => fetchPullPreview(repo, n)));
	} catch (err) {
		if (err instanceof GhError) return c.json({ error: err.message, kind: err.kind }, 502);
		throw err;
	}
});

export default app;
