import { Hono } from 'hono';
import { z } from 'zod';
import type { Repo } from '@recoder/shared';
import { db } from '../store';

const createRepoSchema = z.object({
	name: z.string().min(1).max(200),
	url: z.string().url().max(2000),
	provider: z.literal('github').default('github'),
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

export default app;
