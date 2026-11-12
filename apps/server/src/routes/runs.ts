import { Hono } from 'hono';
import { db } from '../store';

const app = new Hono();

app.get('/', async (c) => c.json(await db.runs.list()));

app.get('/:id', async (c) => {
	const run = await db.runs.get(c.req.param('id'));

	if (!run) return c.json({ error: 'run not found' }, 404);

	return c.json(run);
});

export default app;
