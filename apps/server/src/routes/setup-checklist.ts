import type { SetupChecklist } from '@recoder/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { currentAccount, hasBearerAccess } from '../accounts/enforcement';
import type { AddressReader } from '../deploy/diagnostics/address';
import { storageIdentity } from '../deploy/diagnostics/storage';
import { deploymentRouteError, protectDeploymentMutation } from '../deploy/setup/access';
import { confirmBuiltin, finishSetup, readSetupChecklist } from '../deploy/setup/checklist';

interface SetupChecklistOptions {
	readAddress?: AddressReader;
}

const storageSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('builtin') }),
	z.object({ kind: z.literal('postgres') })
]);

export function createSetupChecklistRoutes({ readAddress }: SetupChecklistOptions = {}) {
	const app = new Hono();

	app.onError(deploymentRouteError);
	app.use('*', protectDeploymentMutation);

	app.get('/', async (c) => {
		if (!hasBearerAccess(c) && (await currentAccount(c))?.role === 'member') {
			return c.json({ complete: true, steps: [] } satisfies SetupChecklist);
		}

		return c.json(await readSetupChecklist(c, readAddress));
	});

	app.post('/finish', async (c) => {
		const result = await finishSetup(c, readAddress);

		return 'error' in result ? c.json(result, 409) : c.json(result);
	});

	app.post('/storage', async (c) => {
		const parsed = storageSchema.safeParse(await c.req.json().catch(() => null));

		if (!parsed.success) return c.json({ error: 'Choose a supported storage option.' }, 400);

		const storage = parsed.data;

		if (storageIdentity().kind === 'postgres') {
			return c.json({ error: 'This server already runs on PostgreSQL. Change its storage outside setup.' }, 409);
		}

		if (storage.kind === 'builtin') return c.json(await confirmBuiltin(c, readAddress));

		return c.json({ error: 'Stop Recoder and use the offline migration guide to switch to PostgreSQL.' }, 409);
	});

	return app;
}
