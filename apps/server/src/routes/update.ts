import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { updateService, UpdateBusyError, UpdateRefusedError } from '../update/service';

/**
 * The admin's "Update Recoder" actions: read the status, re-check upstream,
 * apply, or switch the checkout to another branch — applies run in the
 * background while GET reports their progress.
 * Admin-only: `isAdminOnly` refuses a member before these routes run.
 */
const app = new Hono();

/** A git branch name as a person picks it; the service checks it against the remote's. */
const switchSchema = z.object({ branch: z.string().trim().min(1).max(255) });

/** Starts a background apply, or answers 409 with why it cannot start. */
async function started(c: Context, begin: () => ReturnType<typeof updateService.apply>) {
	try {
		return c.json(await begin(), 202);
	} catch (error) {
		if (error instanceof UpdateRefusedError || error instanceof UpdateBusyError) {
			return c.json({ error: error.message }, 409);
		}

		throw error;
	}
}

app.get('/', async (c) => c.json(await updateService.status()));

app.post('/check', async (c) => c.json(await updateService.check()));

app.post('/', (c) => started(c, updateService.apply));

app.get('/branches', async (c) => c.json(await updateService.branches()));

app.post('/branch', async (c) => {
	const parsed = switchSchema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) return c.json({ error: 'Pick a branch.' }, 400);

	return started(c, () => updateService.switchBranch(parsed.data.branch));
});

export default app;
