import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configForOrchestrator } from './models';
import {
	getStoredSettings,
	initReviewSettings,
	saveReviewSettings,
	setConnection,
	setReviewOverrides
} from './review-settings';

const originalDataDir = process.env.RECODER_DATA_DIR;

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-settings-'));
	setReviewOverrides({});
});

afterEach(() => {
	process.env.RECODER_DATA_DIR = originalDataDir;
	setReviewOverrides({});
});

test('a hosted provider key and its models survive a restart', () => {
	setConnection('opencode-go', 'sk-go-123');

	saveReviewSettings({
		models: [{ id: 'go:glm', source: 'opencode-go', label: 'GLM-5.2', model: 'glm-5.2', contextWindow: 1_000_000 }]
	});

	setReviewOverrides({});
	initReviewSettings();
	expect(getStoredSettings().connections).toEqual({ 'opencode-go': { apiKey: 'sk-go-123' } });
	expect(getStoredSettings().models?.[0]).toMatchObject({ source: 'opencode-go', contextWindow: 1_000_000 });

	expect(configForOrchestrator()).toMatchObject({
		baseUrl: 'https://opencode.ai/zen/go/v1',
		apiKey: 'sk-go-123',
		model: 'glm-5.2',
		source: 'opencode-go'
	});
});

test('disconnecting a provider removes its models and the picks that pointed at them', () => {
	setConnection('opencode-go', 'sk-go-123');

	saveReviewSettings({
		models: [
			{ id: 'go:glm', source: 'opencode-go', label: 'GLM-5.2', model: 'glm-5.2' },
			{ id: 'local', label: 'Local', model: 'qwen', baseUrl: 'http://localhost:8000/v1' }
		],
		orchestratorModelId: 'go:glm'
	});

	setConnection('opencode-go', null);
	expect(getStoredSettings().models?.map((entry) => entry.id)).toEqual(['local']);
	expect(getStoredSettings().orchestratorModelId).toBeUndefined();
});
