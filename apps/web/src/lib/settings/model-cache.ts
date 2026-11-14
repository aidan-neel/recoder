import type { ModelSettings } from '@recoder/shared';

/**
 * Model settings as kept in localStorage: everything a picker needs to paint,
 * minus whether an API key is set, which never leaves the server's answer.
 */
export function cacheableModelSettings(config: ModelSettings): ModelSettings {
	return {
		...config,
		apiKeySet: false,
		models: config.models.map((entry) => ({ ...entry, apiKeySet: false }))
	};
}
