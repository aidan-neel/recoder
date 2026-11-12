import { Hono } from 'hono';
import { freshOpenPulls, openPulls } from '../forge/pulls/cached';
import { listOpenPulls } from '../forge/pulls/list';
import { db } from '../store';

const app = new Hono();

/**
 * Open pull requests across every tracked repository (or `?repoId=` alone),
 * each with its newest review. `?fresh=1` asks the forges again instead of
 * answering from the last ten seconds.
 */
app.get('/', async (c) => {
	const repoId = c.req.query('repoId');
	const repos = await db.repos.list();
	const selected = repoId === undefined ? repos : repos.filter((repo) => repo.id === repoId);

	if (repoId !== undefined && selected.length === 0) return c.json({ error: 'repo not found' }, 404);

	const loadPulls = c.req.query('fresh') === '1' ? freshOpenPulls : openPulls;

	return c.json(await listOpenPulls(selected, await db.reviews.list(), loadPulls));
});

export default app;
