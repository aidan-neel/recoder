import { app } from './app';
import { env } from './env';
import { initReviewSettings } from './lib/review-settings';
import { initTokenStore } from './lib/tokens';

initTokenStore();
initReviewSettings();

const server = Bun.serve({
	fetch: app.fetch,
	port: env.PORT,
	hostname: env.HOST
});

// eslint-disable-next-line no-console
console.log(`recoder server listening on http://${server.hostname}:${server.port}`);
