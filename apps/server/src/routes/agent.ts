import { Hono } from 'hono';
import { z } from 'zod';
import { OpenCodeError, opencode } from '../agents/opencode/opencode';
import { agentStatuses } from '../agents/registry';
import { trustedOrigin } from './trusted-origin';

/** The agent CLIs: every one's status, then OpenCode's providers and sign-in. */
const app = new Hono();

app.use('*', trustedOrigin);

function fail(e: unknown, fallback: string) {
	const status = e instanceof OpenCodeError ? e.status : 502;

	return { body: { error: e instanceof Error ? e.message : fallback }, status: status as 400 | 404 | 502 | 504 };
}

/** Every known agent: installed, version, sign-in state. `?refresh=1` checks again. */
app.get('/', async (c) => c.json({ agents: await agentStatuses(c.req.query('refresh') === '1') }));

app.get('/providers', async (c) => {
	try {
		return c.json({ providers: await opencode.providers() });
	} catch (e) {
		const { body, status } = fail(e, 'Could not list providers.');

		return c.json(body, status);
	}
});

const inputsSchema = z.record(z.string().max(100), z.string().max(2000)).default({});
const keySchema = z.object({ key: z.string().trim().min(1).max(4000), inputs: inputsSchema });

app.put('/providers/:id/key', async (c) => {
	const parsed = keySchema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) return c.json({ error: 'Paste an API key.' }, 400);

	try {
		await opencode.setKey(c.req.param('id'), parsed.data.key, parsed.data.inputs);

		return c.json({ providers: await opencode.providers() });
	} catch (e) {
		const { body, status } = fail(e, 'Could not save the key.');

		return c.json(body, status);
	}
});

app.delete('/providers/:id', async (c) => {
	try {
		await opencode.remove(c.req.param('id'));

		return c.json({ providers: await opencode.providers() });
	} catch (e) {
		const { body, status } = fail(e, 'Could not remove the provider.');

		return c.json(body, status);
	}
});

const oauthSchema = z.object({ method: z.number().int().min(0).max(50), inputs: inputsSchema });

app.post('/providers/:id/oauth', async (c) => {
	const parsed = oauthSchema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) return c.json({ error: 'invalid body' }, 400);

	try {
		return c.json(await opencode.startOAuth(c.req.param('id'), parsed.data.method, parsed.data.inputs));
	} catch (e) {
		const { body, status } = fail(e, 'Could not start the sign-in.');

		return c.json(body, status);
	}
});

app.get('/oauth/:attempt', (c) => {
	const state = opencode.attempt(c.req.param('attempt'));

	return state ? c.json(state) : c.json({ error: 'That sign-in expired. Start again.' }, 404);
});

app.post('/oauth/:attempt/code', async (c) => {
	const parsed = z.object({ code: z.string().trim().min(1).max(4000) }).safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) return c.json({ error: 'Paste the code.' }, 400);

	try {
		return c.json(await opencode.submitCode(c.req.param('attempt'), parsed.data.code));
	} catch (e) {
		const { body, status } = fail(e, 'Sign-in failed.');

		return c.json(body, status);
	}
});

app.delete('/oauth/:attempt', (c) => {
	opencode.cancel(c.req.param('attempt'));

	return c.json({ ok: true });
});

export default app;
