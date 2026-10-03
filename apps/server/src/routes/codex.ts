import { Hono } from 'hono';
import { codex } from '../agents/codex/codex';
import { LlmError } from '../models/llm';
import { trustedOrigin } from './trusted-origin';

const app = new Hono();

app.use('*', trustedOrigin);

app.get('/status', async (c) => c.json(await codex.status()));

app.post('/connect', async (c) => {
	try {
		return c.json(await codex.connect());
	} catch (error) {
		return c.json({ error: error instanceof LlmError ? error.message : 'ChatGPT sign-in failed. Try again.' }, 409);
	}
});

app.post('/disconnect', async (c) => {
	try {
		await codex.disconnect();

		return c.json({ ok: true });
	} catch (error) {
		return c.json(
			{ error: error instanceof LlmError ? error.message : 'Could not disconnect ChatGPT. Try again.' },
			409
		);
	}
});

app.get('/models', async (c) => {
	try {
		return c.json(await codex.models());
	} catch (error) {
		return c.json(
			{ error: error instanceof LlmError ? error.message : 'Could not load ChatGPT models. Try again.' },
			409
		);
	}
});

export default app;
