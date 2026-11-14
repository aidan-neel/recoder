import type { Repo } from '@recoder/shared';
import { Hono } from 'hono';
import { freshOpenPulls, openPulls } from '../forge/pulls/cached';
import { listOpenPulls } from '../forge/pulls/list';
import { db } from '../store';

const app = new Hono();

/**
 * The first page of open pull requests of every tracked repository (or
 * `?repoId=` alone), each with its newest review. `?repoId=&after=` reads the
 * page after a cursor from `nextCursors`. `?fresh=1` asks the forges again
 * instead of answering from the last ten seconds.
 */
app.get('/', async (c) => {
	const repoId = c.req.query('repoId');
	const repos = await db.repos.list();
	const selected = repoId === undefined ? repos : repos.filter((repo) => repo.id === repoId);

	if (repoId !== undefined && selected.length === 0) return c.json({ error: 'repo not found' }, 404);

	const after = c.req.query('after') ?? null;

	if (after !== null && repoId === undefined) return c.json({ error: 'after needs a repoId' }, 400);

	const read = c.req.query('fresh') === '1' ? freshOpenPulls : openPulls;
	const loadPulls = (repo: Repo) => read(repo, after);

	return c.json(await listOpenPulls(selected, await db.reviews.list(), loadPulls));
});

export default app;
