import type { ServerCheck, ServerCheckId } from '@recoder/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AddressReader } from '../deploy/diagnostics/address';
import { isServerCheckId, readServerChecks, startServerChecks } from '../deploy/diagnostics/checks';
import { probeServerCheck, serverOverview } from '../deploy/diagnostics/probes';
import { postgresConnectionUrl, testPostgres } from '../deploy/diagnostics/storage';
import { deploymentRouteError, protectDeploymentMutation } from '../deploy/setup/access';

interface ServerInfoOptions {
	readAddress?: AddressReader;
	runCheck?: (id: ServerCheckId) => Promise<ServerCheck>;
	connectPostgres?: (url: string) => Promise<string>;
}

const storageSchema = z.object({ url: z.string().trim().min(1).max(4096) });

export function createServerInfoRoutes({ readAddress, runCheck, connectPostgres }: ServerInfoOptions = {}) {
	const app = new Hono();

	app.onError(deploymentRouteError);
	app.use('*', protectDeploymentMutation);

	app.get('/', async (c) => c.json(await serverOverview(readAddress)));
	app.get('/checks', async (c) => c.json(await readServerChecks()));

	app.post('/checks', async (c) => {
		const only = c.req.query('only');

		if (only !== undefined && !isServerCheckId(only)) return c.json({ error: 'Unknown server check.' }, 400);

		const checks = await startServerChecks(runCheck ?? ((id) => probeServerCheck(id, readAddress)), only);

		return checks ? c.json(checks, 202) : c.json({ error: 'Server checks are already running.' }, 409);
	});

	app.post('/storage/test', async (c) => {
		const parsed = storageSchema.safeParse(await c.req.json().catch(() => null));

		if (!parsed.success || !postgresConnectionUrl(parsed.data.url)) {
			return c.json({ error: 'Enter a valid PostgreSQL connection URL.' }, 400);
		}

		return c.json(await testPostgres(parsed.data.url, connectPostgres));
	});

	return app;
}
