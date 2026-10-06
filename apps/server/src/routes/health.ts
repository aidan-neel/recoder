import { Hono } from 'hono';
import { serverIdentity } from '../eval/server-identity';
import { VERSION } from '../version';

const app = new Hono();

app.get('/', (c) =>
	c.json({
		ok: true,
		name: 'recoder',
		version: VERSION,
		uptimeSeconds: Math.floor(process.uptime())
	})
);

/** The flags, limits, cache versions, tools and checkout a benchmark records as this server's part of its identity. */
app.get('/identity', async (c) => c.json(await serverIdentity()));

export default app;
