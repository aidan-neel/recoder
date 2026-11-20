import type { ErrorHandler, MiddlewareHandler } from 'hono';

export const noStoreDeploymentResponse: MiddlewareHandler = async (c, next) => {
	c.header('Cache-Control', 'no-store');

	await next();
};

export const deploymentRouteError: ErrorHandler = (_error, c) =>
	c.json({ error: 'The server could not complete this operation.' }, 500);
