import type { ModelSettings } from '@recoder/shared';

/**
 * Model settings as kept in localStorage: everything a picker needs to paint,
 * minus the API key previews, which never leave the server's answer.
 */
export function cacheableModelSettings(config: ModelSettings): ModelSettings {
	return {
		...config,
		apiKeyPreview: null,
		models: config.models.map((entry) => ({ ...entry, apiKeyPreview: null }))
	};
}
