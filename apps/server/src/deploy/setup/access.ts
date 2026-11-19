import type { ErrorHandler, MiddlewareHandler } from 'hono';
import { SAFE_METHODS } from '../../accounts/admin-routes';
import { refuseWhileLocked } from '../../accounts/setup-gate';
import { trustedOrigin } from '../../routes/trusted-origin';

export const protectDeploymentMutation: MiddlewareHandler = async (c, next) => {
	c.header('Cache-Control', 'no-store');

	if (SAFE_METHODS.has(c.req.method)) return next();

	const locked = await refuseWhileLocked(c);

	return locked ?? trustedOrigin(c, next);
};

export const deploymentRouteError: ErrorHandler = (_error, c) =>
	c.json({ error: 'The server could not complete this operation.' }, 500);
