import { Hono } from 'hono';
import { refuseWhileLocked } from '../accounts/setup-gate';
import { logQuery, readServerLogs, streamServerLogs } from '../deploy/logs/stream';

const app = new Hono();

app.use('*', async (c, next) => (await refuseWhileLocked(c)) ?? next());

app.get('/', (c) => {
	const query = logQuery.safeParse(c.req.query());

	return query.success ? c.json(readServerLogs(query.data)) : c.json({ error: 'Invalid log filters.' }, 400);
});

app.get('/events', streamServerLogs);

export default app;
