import { Hono } from 'hono';
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

export default app;
