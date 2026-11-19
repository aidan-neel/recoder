import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { updateService, UpdateBusyError, UpdateRefusedError } from '../update/service';
import { currentAccount } from '../accounts/enforcement';
import { protectDeploymentMutation } from '../deploy/setup/access';
import { configuredUpdater } from '../update/container/connection';
import {
	beginContainer,
	containerHistory,
	containerLog,
	readPolicy,
	updatePolicySchema,
	writePolicy
} from '../update/container/server';
import { UpdaterRefused } from '../update/container/protocol';

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
		if (error instanceof UpdateRefusedError || error instanceof UpdateBusyError || error instanceof UpdaterRefused) {
			return c.json({ error: error.message }, 409);
		}

		throw error;
	}
}

app.use('*', protectDeploymentMutation);

app.get('/', async (c) => c.json(await updateService.status()));

app.post('/check', async (c) => c.json(await updateService.check()));

app.post('/', async (c) => {
	const socket = await configuredUpdater();

	if (!socket) return started(c, updateService.apply);

	return started(c, async () => {
		const status = await updateService.check();
		const version = status.available?.version;

		if (!version || status.blockedReason)
			throw new UpdaterRefused(status.blockedReason ?? 'There is no available update.');

		return beginContainer(socket, { action: 'install', version }, (await currentAccount(c))?.name ?? null);
	});
});

app.post('/rollback', async (c) => {
	const socket = await configuredUpdater();
	const body = z.object({ version: z.string().max(100) }).safeParse(await c.req.json().catch(() => null));

	if (!socket) return c.json({ error: 'This deployment is not managed by the updater.' }, 409);
	if (!body.success) return c.json({ error: 'Choose a version from update history.' }, 400);

	return started(c, async () =>
		beginContainer(socket, { action: 'rollback', version: body.data.version }, (await currentAccount(c))?.name ?? null)
	);
});

app.get('/history', async (c) => {
	const socket = await configuredUpdater();

	return c.json({ entries: socket ? await containerHistory(socket) : [] });
});

app.get('/history/:id/log', async (c) => {
	const socket = await configuredUpdater();
	const log = socket ? await containerLog(socket, c.req.param('id')) : undefined;

	return log ? c.json(log) : c.json({ error: 'Update log not found.' }, 404);
});

app.get('/policy', async (c) => {
	if (!(await configuredUpdater())) return c.json({ error: 'This deployment is not managed by the updater.' }, 409);

	return c.json(await readPolicy());
});

app.put('/policy', async (c) => {
	if (!(await configuredUpdater())) return c.json({ error: 'This deployment is not managed by the updater.' }, 409);

	const value = updatePolicySchema.safeParse(await c.req.json().catch(() => null));

	if (!value.success) return c.json({ error: 'Choose a valid update window. Updates must have a backup.' }, 400);

	return c.json(await writePolicy(value.data));
});

app.get('/branches', async (c) => {
	if (await configuredUpdater())
		return c.json({ error: 'Branch switching is only available for a Git checkout.' }, 409);

	return c.json(await updateService.branches());
});

app.post('/branch', async (c) => {
	if (await configuredUpdater())
		return c.json({ error: 'Branch switching is only available for a Git checkout.' }, 409);

	const parsed = switchSchema.safeParse(await c.req.json().catch(() => null));

	if (!parsed.success) return c.json({ error: 'Pick a branch.' }, 400);

	return started(c, () => updateService.switchBranch(parsed.data.branch));
});

export default app;
