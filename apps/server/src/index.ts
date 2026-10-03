import { app } from './app';
import { env } from './env';
import { serverDataDir } from './util/data-dir';
import { opencode } from './agents/opencode/opencode';
import { initReviewSettings } from './review/session/review-settings';
import { initTokenStore } from './forge/tokens';
import { recoverStaleReviews } from './store';

/** Start the agent now so Settings never waits on a cold start, and warm its provider catalog. */
function warmAgent(): void {
	void opencode
		.detect()
		.then((status) => (status.error ? undefined : opencode.providers()))
		.catch(() => {});
}

/**
 * Requests that may sit quiet past the idle timeout: review conversations stay
 * subscribed while the agents are idle, and a guidelines draft can think for a
 * long time before its first token.
 */
function isLongLived(path: string): boolean {
	return /^\/api\/reviews\/[^/]+\/events$/.test(path) || path === '/api/guidelines/draft';
}

initTokenStore();
initReviewSettings();
recoverStaleReviews();
warmAgent();

const server = Bun.serve({
	fetch(request, server) {
		if (isLongLived(new URL(request.url).pathname)) server.timeout(request, 0);

		return app.fetch(request, server);
	},
	port: env.PORT,
	hostname: env.HOST
});

console.log(`recoder server listening on http://${server.hostname}:${server.port}`);

console.log(`recoder data dir: ${serverDataDir()}`);
