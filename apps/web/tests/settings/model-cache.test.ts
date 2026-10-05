import { describe, expect, test } from 'bun:test';
import type { ModelSettings } from '@recoder/shared';
import { cacheableModelSettings } from '../../src/lib/settings/model-cache';

const settings: ModelSettings = {
	configured: true,
	baseUrl: 'https://api.example.com/v1',
	model: 'glm-5.3',
	apiKeyPreview: 'sk-…a1b2',
	sharedModelId: 'glm',
	models: [
		{
			id: 'glm',
			label: 'GLM',
			model: 'glm-5.3',
			baseUrl: 'https://api.example.com/v1',
			apiKeyPreview: 'sk-…c3d4'
		}
	],
	subagentCap: 2,
	reportLowSeverity: false,
	limits: { maxFiles: 50, maxDiffChars: 100_000, maxFileChars: 20_000 }
};

describe('cacheableModelSettings', () => {
	test('drops every API key preview before the settings are stored', () => {
		const stored = JSON.stringify(cacheableModelSettings(settings));

		expect(stored).not.toContain('sk-');
		expect(stored).toContain('glm-5.3');
	});
});
