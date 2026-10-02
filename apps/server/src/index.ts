import { app } from './app';
import { env } from './env';
import { serverDataDir } from './util/data-dir';
import { opencode } from './agents/opencode/opencode';
import { initReviewSettings } from './review/session/review-settings';
import { initTokenStore } from './forge/tokens';
import { recoverStaleReviews } from './store';

initTokenStore();
initReviewSettings();
recoverStaleReviews();

// Start the agent now so Settings never waits on a cold start, and warm its provider catalog.
void opencode
	.detect()
	.then((status) => (status.error ? undefined : opencode.providers()))
	.catch(() => {});

const server = Bun.serve({
	fetch(request, server) {
		// Review conversations stay subscribed even when the agents are idle, and a
		// guidelines draft can think for longer than the idle timeout before its first token.
		const path = new URL(request.url).pathname;

		if (/^\/api\/reviews\/[^/]+\/events$/.test(path) || path === '/api/guidelines/draft') server.timeout(request, 0);

		return app.fetch(request, server);
	},
	port: env.PORT,
	hostname: env.HOST
});

console.log(`recoder server listening on http://${server.hostname}:${server.port}`);

console.log(`recoder data dir: ${serverDataDir()}`);
