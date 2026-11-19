import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { isHttps } from '../accounts/session-cookie';
import type { AddressDeps } from '../deploy/setup/address';
import { readSetupAddress, realDeps, setDomainAddress, setExternalAddress } from '../deploy/setup/address';
import { deploymentRouteError, protectDeploymentMutation } from '../deploy/setup/access';

const setAddressSchema = z.union([z.object({ domain: z.string() }), z.object({ external: z.string() })]);

/** Test seams for the address step; the routes themselves keep none. */
interface SetupAddressOptions {
	deps?: AddressDeps;
}

/**
 * The address step's routes: `GET` reports where the server stands (the wizard polls it while a certificate is
 * pending), `POST` sets a domain for Caddy to serve, or the address of a proxy that already ends TLS.
 */
export function createSetupAddressRoutes({ deps = realDeps() }: SetupAddressOptions = {}) {
	const app = new Hono();

	app.onError(deploymentRouteError);
	app.use('*', protectDeploymentMutation);

	app.get('/', async (c) => c.json(await readSetupAddress(reachedAt(c), deps)));

	app.post('/', async (c) => {
		const parsed = setAddressSchema.safeParse(await c.req.json().catch(() => null));

		if (!parsed.success) {
			return c.json({ error: 'Send the domain to serve, or the address of a proxy that already terminates TLS.' }, 400);
		}

		const result =
			'domain' in parsed.data
				? await setDomainAddress(parsed.data.domain, deps)
				: await setExternalAddress(parsed.data.external);

		if ('error' in result) return c.json({ error: result.error }, 409);

		return c.json(await readSetupAddress(reachedAt(c), deps));
	});

	return app;
}

/** The address this request reached the server on, which is what the browser can open. */
function reachedAt(c: Context): string {
	return `${isHttps(c) ? 'https' : 'http'}://${new URL(c.req.url).host}`;
}
