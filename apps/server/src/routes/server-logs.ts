import { Hono } from 'hono';
import { logQuery, readServerLogs, streamServerLogs } from '../deploy/logs/stream';

const app = new Hono();

app.get('/', (c) => {
	const query = logQuery.safeParse(c.req.query());

	return query.success ? c.json(readServerLogs(query.data)) : c.json({ error: 'Invalid log filters.' }, 400);
});

app.get('/events', streamServerLogs);

export default app;
