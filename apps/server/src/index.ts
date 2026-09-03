import { app } from './app';
import { env } from './env';

const server = Bun.serve({
	fetch: app.fetch,
	port: env.PORT,
	hostname: env.HOST
});

// eslint-disable-next-line no-console
console.log(`recoder server listening on http://${server.hostname}:${server.port}`);
