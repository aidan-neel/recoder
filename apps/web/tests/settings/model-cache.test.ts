import { describe, expect, test } from 'bun:test';
import type { ModelSettings } from '@recoder/shared';
import { cacheableModelSettings } from '../../src/lib/settings/model-cache';

const settings: ModelSettings = {
	configured: true,
	baseUrl: 'https://api.example.com/v1',
	model: 'glm-5.3',
	apiKeySet: true,
	sharedModelId: 'glm',
	models: [
		{
			id: 'glm',
			label: 'GLM',
			model: 'glm-5.3',
			baseUrl: 'https://api.example.com/v1',
			apiKeySet: true
		}
	],
	subagentCap: 8,
	tokenBudget: 'medium',
	reportLowSeverity: false,
	disabledProviders: [],
	hiddenModels: [],
	modelPolicy: { kind: 'choose' },
	limits: { maxFiles: 50, maxDiffChars: 100_000, maxFileChars: 20_000 }
};

describe('cacheableModelSettings', () => {
	test('clears every API key flag before the settings are stored', () => {
		const stored = cacheableModelSettings(settings);

		expect(stored.apiKeySet).toBe(false);
		expect(stored.models.map((entry) => entry.apiKeySet)).toEqual([false]);
		expect(stored.model).toBe('glm-5.3');
	});
});
