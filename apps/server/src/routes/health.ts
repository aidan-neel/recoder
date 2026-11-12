import { Hono } from 'hono';
import { serverIdentity } from '../eval/server-identity';
import { VERSION } from '../version';
import { postgres } from '../storage/backend';

const app = new Hono();

app.get('/ready', async (c) => {
	try {
		if (postgres) await postgres`SELECT 1 FROM recoder_records LIMIT 1`;

		return c.json({ ok: true });
	} catch {
		return c.json({ ok: false, error: 'Shared storage is unavailable.' }, 503);
	}
});

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
