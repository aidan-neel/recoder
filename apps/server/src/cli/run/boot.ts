import { initVllmServers } from '../../models/vllm/vllm-store.js';
import { readReviewSettings } from '../../review/session/review-settings.js';

/**
 * Loads what a review reads from the user's saved files: the model settings, and the captured vLLM servers that a
 * saved pick may name. Nothing is written: a settings file in an older format is read in the current shape and left as
 * it is, which only the server's own start rewrites. The server's other boot work (stale-review recovery, the agent warm-up, the vLLM sync and the
 * pull-request watcher) serves a long-running process and is left out.
 */
export function bootHeadless(): void {
	readReviewSettings();
	initVllmServers();
}
