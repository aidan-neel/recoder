import { app } from './app';
import { env } from './env';
import { serverDataDir } from './lib/data-dir';
import { initReviewSettings } from './lib/review-settings';
import { initTokenStore } from './lib/tokens';
import { recoverStaleReviews } from './store';

initTokenStore();
initReviewSettings();
recoverStaleReviews();

const server = Bun.serve({
	fetch(request, server) {
		// Review conversations stay subscribed even when the agents are idle.
		if (/^\/api\/reviews\/[^/]+\/events$/.test(new URL(request.url).pathname)) server.timeout(request, 0);
		return app.fetch(request, server);
	},
	port: env.PORT,
	hostname: env.HOST
});

// eslint-disable-next-line no-console
console.log(`recoder server listening on http://${server.hostname}:${server.port}`);
// eslint-disable-next-line no-console
console.log(`recoder data dir: ${serverDataDir()}`);
