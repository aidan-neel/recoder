import type { ModelEntry } from '@recoder/shared';

/** A Claude Code model as the settings registry lists it, with a low and a high effort. */
export function claudeCodeModel(name: string): ModelEntry {
	return {
		id: `claude-code:${name}`,
		label: name,
		model: name,
		baseUrl: null,
		apiKeySet: false,
		efforts: ['low', 'high']
	};
}
