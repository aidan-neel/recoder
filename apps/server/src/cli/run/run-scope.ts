import type { ReviewTuning } from '../review/options.js';
import type { ModelLookup } from './model-choices.js';
import { redirectConsoleToStderr } from './quiet-console.js';
import { applyRunEnv } from './run-env.js';
import { applyRunSettings } from './run-settings.js';

/**
 * Runs `run` with this review's console redirect, environment switches and settings in place, and puts each back as it
 * was afterwards, also when `run` throws. The process is left as it was found. The settings' model lookups run under
 * `lookup`.
 */
export async function withRunScope<T>(tuning: ReviewTuning, lookup: ModelLookup, run: () => Promise<T>): Promise<T> {
	const restores = [redirectConsoleToStderr(), applyRunEnv(tuning)];

	try {
		restores.push(await applyRunSettings(tuning, lookup));

		return await run();
	} finally {
		for (const restore of [...restores].reverse()) restore();
	}
}
