import { describe, expect, test } from 'bun:test';
import { vllmModelId, type ModelEntry, type ModelSettings, type VllmServer } from '@recoder/shared';

import { missingNote, modelCatalog, rolePick } from '../../src/lib/settings/model-options';
import { syncLine } from '../../src/lib/settings/vllm-text';

const NOW = 1_000_000_000_000;

function server(overrides: Partial<VllmServer> = {}): VllmServer {
	return {
		id: 'v1',
		host: 'vllm.test:8000',
		baseUrl: 'http://vllm.test:8000/v1',
		apiKeySet: false,
		syncedAt: NOW - 120_000,
		error: null,
		models: [
			{ id: 'qwen', contextWindow: 131072, served: true },
			{ id: 'llama', contextWindow: 32768, served: false }
		],
		...overrides
	};
}

function vllmEntry(model: string, unavailable = false): ModelEntry {
	return {
		provider: 'openai-compatible',
		source: 'vLLM · vllm.test:8000',
		id: vllmModelId('v1', model),
		label: model,
		model,
		baseUrl: 'http://vllm.test:8000/v1',
		apiKeySet: false,
		...(unavailable ? { unavailable: true } : {})
	};
}

function settings(models: ModelEntry[], pick: string): ModelSettings {
	return {
		configured: true,
		baseUrl: '',
		model: '',
		apiKeySet: false,
		sharedModelId: null,
		orchestratorModelId: vllmModelId('v1', pick),
		models,
		subagentCap: 8,
		tokenBudget: 'medium',
		reportLowSeverity: true,
		disabledProviders: [],
		hiddenModels: [],
		modelPolicy: { kind: 'choose' },
		limits: { maxFiles: 20, maxDiffChars: 60_000, maxFileChars: 12_000 }
	};
}

describe('a vLLM server’s status line', () => {
	test('counts the models served, the ones missing, and how old the list is', () => {
		expect(syncLine(server(), NOW)).toBe('1 model · 1 not served · Synced 2 minutes ago');
	});

	test('a failed sync says why and how old the list on screen is', () => {
		expect(syncLine(server({ error: 'The server did not answer in time' }), NOW)).toBe(
			'The server did not answer in time. Showing the list from 2 minutes ago.'
		);
	});
});

describe('a pick whose model the server no longer serves', () => {
	test('shows as missing, and the model cannot be chosen again', () => {
		const models = [vllmEntry('qwen'), vllmEntry('llama', true)];
		const pick = rolePick(settings(models, 'llama'), 'orchestrator');

		expect(missingNote(pick)).toContain('is no longer served');
		expect(modelCatalog(models).byId.get(vllmModelId('v1', 'llama'))?.unavailable).toBe(true);
	});

	test('shows as missing when its server was disconnected, and not when the model is served', () => {
		expect(missingNote(rolePick(settings([], 'llama'), 'orchestrator'))).toContain('disconnected');

		const models = [vllmEntry('qwen')];

		expect(missingNote(rolePick(settings(models, 'qwen'), 'orchestrator'))).toBeNull();
	});
});
