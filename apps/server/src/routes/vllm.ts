import { Hono } from 'hono';
import { z } from 'zod';
import type { VllmServer } from '@recoder/shared';
import { listVllmServers, removeVllmServer, toVllmServer } from '../models/vllm/vllm-store';
import { VllmConnectError, connectVllm, syncAllVllm } from '../models/vllm/vllm-sync';
import { parseBody } from './parse-body';
import { trustedOrigin } from './trusted-origin';

/** The vLLM servers whose model lists Recoder keeps in step: connect, refresh, disconnect. */
const app = new Hono();

app.use('*', trustedOrigin);

function serversPayload(): { servers: VllmServer[] } {
	return { servers: listVllmServers().map(toVllmServer) };
}

const connectSchema = z.object({
	baseUrl: z.string().trim().min(1, 'Enter the server address.').max(500),
	apiKey: z.string().max(500).optional()
});

app.get('/', (c) => c.json(serversPayload()));

/** Check the address by listing its models, save it with its key and take that list. `connected` is the server's id. */
app.post('/', async (c) => {
	const body = await parseBody(c, connectSchema);

	if (body instanceof Response) return body;

	try {
		const server = await connectVllm(body.baseUrl, body.apiKey);

		return c.json({ ...serversPayload(), connected: server.id });
	} catch (err) {
		if (err instanceof VllmConnectError) return c.json({ error: err.message }, err.status);

		throw err;
	}
});

const refreshSchema = z.object({ force: z.boolean().optional() });

/** Sync every server now. Without `force`, one synced a moment ago is left alone, so opening Settings is cheap. */
app.post('/refresh', async (c) => {
	const body = refreshSchema.safeParse(await c.req.json().catch(() => ({})));

	await syncAllVllm(body.success && body.data.force === true);

	return c.json(serversPayload());
});

app.delete('/:id', (c) => {
	if (!removeVllmServer(c.req.param('id'))) return c.json({ error: 'unknown server' }, 404);

	return c.json(serversPayload());
});

export default app;
