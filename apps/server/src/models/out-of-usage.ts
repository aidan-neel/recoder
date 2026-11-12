import type { ModelFailure, UsageLimit } from '@recoder/shared';

/**
 * The failure of a call whose plan ran out, naming the plan. `detail` is the provider's own words, when they are
 * written for people: a CLI's limit message carries its reset time.
 */
export function outOfUsage(usageLimit: UsageLimit, detail?: string): ModelFailure {
	const said = detail ? ` (${detail})` : '';

	return {
		reason: `${usageLimit.name} is out of usage${said}. Switch to another model, or wait for it to reset.`,
		usageLimit
	};
}
