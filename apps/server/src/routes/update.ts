import { Hono } from 'hono';
import { updateService, UpdateBusyError, UpdateRefusedError } from '../update/service';

/**
 * The admin's "Update Recoder" actions: read the status, re-check upstream,
 * or apply — which runs in the background while GET reports its progress.
 * Admin-only: `isAdminOnly` refuses a member before these routes run.
 */
const app = new Hono();

app.get('/', async (c) => c.json(await updateService.status()));

app.post('/check', async (c) => c.json(await updateService.check()));

app.post('/', async (c) => {
	try {
		return c.json(await updateService.apply(), 202);
	} catch (error) {
		if (error instanceof UpdateRefusedError) return c.json({ error: error.message }, 409);
		if (error instanceof UpdateBusyError) return c.json({ error: error.message }, 409);

		throw error;
	}
});

export default app;
