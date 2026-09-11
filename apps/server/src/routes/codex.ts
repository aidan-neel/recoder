import { Hono } from 'hono';
import { codex } from '../lib/codex';
import { LlmError } from '../lib/llm';
import { env } from '../env';

const app = new Hono();

// Recoder is a single-user server. Do not let arbitrary websites initiate or
// observe its subscription login, even though the legacy API permits CORS '*'.
app.use('*', async (c, next) => {
	const origin = c.req.header('origin');
	const allowed = new Set([new URL(env.FRONTEND_URL).origin, new URL(c.req.url).origin]);
	if (process.env.NODE_ENV !== 'production') {
		allowed.add('http://localhost:5173');
		allowed.add('http://127.0.0.1:5173');
	}
	if (origin && !allowed.has(origin)) return c.json({ error: 'Untrusted origin' }, 403);
	c.header('Cache-Control', 'no-store');
	await next();
});

app.get('/status', async (c) => c.json(await codex.status()));
app.post('/connect', async (c) => {
	try { return c.json(await codex.connect()); }
	catch (error) { return c.json({ error: error instanceof LlmError ? error.message : 'ChatGPT sign-in failed. Try again.' }, 409); }
});
app.post('/disconnect', async (c) => {
	try { await codex.disconnect(); return c.json({ ok: true }); }
	catch (error) { return c.json({ error: error instanceof LlmError ? error.message : 'Could not disconnect ChatGPT. Try again.' }, 409); }
});
app.get('/models', async (c) => {
	try { return c.json(await codex.models()); }
	catch (error) { return c.json({ error: error instanceof LlmError ? error.message : 'Could not load ChatGPT models. Try again.' }, 409); }
});

export default app;
