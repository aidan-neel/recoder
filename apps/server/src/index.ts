import { app } from './app';
import { env } from './env';
import { serverDataDir } from './util/data-dir';
import { opencode } from './agents/opencode/opencode';
import { initReviewSettings } from './review/session/review-settings';
import { initVllmServers } from './models/vllm/vllm-store';
import { startVllmSync } from './models/vllm/vllm-sync';
import { initTokenStore } from './forge/tokens';
import { restartWatcher } from './forge/watch/watcher';
import { recoverStaleReviews } from './store';

/** Start the agent now so Settings never waits on a cold start, and warm its provider catalog. */
function warmAgent(): void {
	void opencode
		.detect()
		.then((status) => (status.error ? undefined : opencode.providers()))
		.catch(() => {});
}

/**
 * Requests that may sit quiet past Bun's 10 second idle timeout: review
 * conversations stay subscribed while the agents are idle, and model calls
 * (drafts, answers, fixes, the home brief, provider checks) can think for a
 * long time before the first byte. Each route keeps its own deadline.
 */
const LONG_LIVED = [
	/^\/api\/reviews\/[^/]+\/(events|discuss|discuss\/stream|rereview|fixes\/suggest)$/,
	/^\/api\/guidelines\/draft$/,
	/^\/api\/home\/brief$/,
	/^\/api\/settings\/providers\/[^/]+\/(connect|catalog)$/,
	/^\/api\/settings\/models(\/discover)?$/,
	/^\/api\/settings\/vllm(\/refresh)?$/
];

function isLongLived(path: string): boolean {
	return LONG_LIVED.some((pattern) => pattern.test(path));
}

initTokenStore();
initReviewSettings();
initVllmServers();
recoverStaleReviews();
warmAgent();
startVllmSync();
restartWatcher();

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
