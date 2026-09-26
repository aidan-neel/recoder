import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../app';
import { effectiveReviewEnv, getStoredSettings, initReviewSettings, setReviewOverrides } from '../lib/review-settings';
import { configForOrchestrator, configForRole, isReviewConfigured } from '../lib/models';

const ENV_KEYS = [
	'RECODER_REVIEW_BASE_URL',
	'RECODER_REVIEW_API_KEY',
	'RECODER_REVIEW_MODEL',
	'RECODER_DATA_DIR'
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (savedEnv[k] === undefined) delete process.env[k];
		else process.env[k] = savedEnv[k];
	}
	setReviewOverrides({});
});

function isolateDataDir(): void {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-settings-'));
}

beforeEach(isolateDataDir);

describe('review settings', () => {
	test('orchestrator and specialist models route independently and survive reload', async () => {
		const response = await app.request('/api/settings/models', {
			method: 'PATCH', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				models: [
					{ id: 'lead', label: 'Lead', model: 'lead-model', provider: 'codex' },
					{ id: 'worker', label: 'Worker', model: 'worker-model', provider: 'codex' }
				], orchestratorModelId: 'lead', specialistModelId: 'worker'
			})
		});
		expect(response.status).toBe(200);
		setReviewOverrides({});
		initReviewSettings();
		expect(configForOrchestrator().model).toBe('lead-model');
		expect(configForRole('correctness').model).toBe('worker-model');
		expect(configForRole('security').model).toBe('worker-model');
		const settings = await (await app.request('/api/settings/models')).json();
		expect(settings.orchestratorModelId).toBe('lead');
		expect(settings.specialistModelId).toBe('worker');
	});
	test('Review and Specialist efforts persist across reload and survive a model change', async () => {
		setReviewOverrides({ models: [{ id: 'sub', label: 'Subscription', model: 'test-model', provider: 'codex' }] });
		const patch = await app.request('/api/settings/models', {
			method: 'PATCH', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ orchestratorEffort: 'low', specialistEffort: 'high' })
		});
		expect(patch.status).toBe(200);
		expect(await patch.json()).toMatchObject({ orchestratorEffort: 'low', specialistEffort: 'high' });
		setReviewOverrides({});
		initReviewSettings();
		expect(configForOrchestrator().reasoningEffort).toBe('low');
		expect(configForRole('docs').reasoningEffort).toBe('high');
		const changedModel = await app.request('/api/settings/models', {
			method: 'PATCH', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ models: [{ id: 'new', label: 'New', model: 'new-model', provider: 'codex' }] })
		});
		expect(changedModel.status).toBe(200);
		expect(configForRole('security')).toMatchObject({ model: 'new-model', reasoningEffort: 'high' });
	});

	test('invalid effort values are rejected without changing settings', async () => {
		setReviewOverrides({ specialistEffort: 'high' });
		for (const specialistEffort of ['ultra', '', 1, [], {}]) {
			const res = await app.request('/api/settings/models', {
				method: 'PATCH', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ specialistEffort })
			});
			expect(res.status).toBe(400);
			expect(getStoredSettings().specialistEffort).toBe('high');
		}
	});

	test('a saved file with per-role picks loads as one Specialist pick', async () => {
		const legacy = (extra: object) => writeFileSync(join(process.env.RECODER_DATA_DIR!, 'review-config.json'), JSON.stringify({
			models: [{ id: 'lead', label: 'Lead', model: 'lead-model', provider: 'codex' }, { id: 'worker', label: 'Worker', model: 'worker-model', provider: 'codex' }],
			orchestratorModelId: 'lead', roles: { correctness: 'worker', security: 'lead' }, roleEfforts: { correctness: 'high', docs: 'low' }, ...extra
		}));
		legacy({});
		initReviewSettings();
		expect(getStoredSettings()).toMatchObject({ specialistModelId: 'worker', specialistEffort: 'high', orchestratorEffort: 'high' });
		expect(getStoredSettings()).not.toHaveProperty('roles');
		expect(configForRole('security')).toMatchObject({ model: 'worker-model', reasoningEffort: 'high' });
		setReviewOverrides({});
		legacy({ applyToSpecialists: true });
		initReviewSettings();
		expect(getStoredSettings().specialistModelId).toBeUndefined();
		expect(configForRole('security').model).toBe('lead-model');
	});

	test('PUT stores config and GET masks the key', async () => {
		isolateDataDir();
		const put = await app.request('/api/settings/models', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				baseUrl: 'https://openrouter.ai/api/v1',
				apiKey: 'sk-or-secret1234',
				models: [
					{ id: 'm1', label: 'Qwen coder', model: 'qwen/qwen-2.5-coder-32b-instruct' },
					{ label: 'Qwen max', model: 'qwen/qwen-max' }
				],
				sharedModelId: 'm1'
			})
		});
		expect(put.status).toBe(200);
		const saved = await put.json();
		expect(saved.configured).toBe(true);
		expect(saved.apiKeyPreview).toBe('••••1234');
		expect(saved.sharedModelId).toBe('m1');

		const get = await app.request('/api/settings/models');
		const body = await get.json();
		expect(body.baseUrl).toBe('https://openrouter.ai/api/v1');
		expect(body.model).toBe('qwen/qwen-2.5-coder-32b-instruct');
		expect(body.models).toHaveLength(2);
		expect(body.models[0]).toMatchObject({ id: 'm1', label: 'Qwen coder' });
		expect(typeof body.models[1].id).toBe('string');
		expect(isReviewConfigured()).toBe(true);
	});

	test('empty key keeps the existing one', async () => {
		isolateDataDir();
		setReviewOverrides({ apiKey: 'keepme' });
		const put = await app.request('/api/settings/models', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ baseUrl: 'http://localhost:8000/v1', apiKey: '', model: 'm' })
		});
		expect(put.status).toBe(200);
		expect(effectiveReviewEnv().apiKey).toBe('keepme');
	});

	test('stored settings win over env', async () => {
		process.env.RECODER_REVIEW_MODEL = 'env-model';
		setReviewOverrides({
			models: [{ id: 'm1', label: 'UI', model: 'ui-model' }],
			sharedModelId: 'm1'
		});
		expect(effectiveReviewEnv().model).toBe('ui-model');
		setReviewOverrides({});
		expect(effectiveReviewEnv().model).toBe('env-model');
	});

	test('codex subscription model is listed and selectable as shared', async () => {
		isolateDataDir();
		const codexId = 'codex-shared-1';
		const put = await app.request('/api/settings/models', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				models: [
					{ provider: 'codex', id: codexId, label: 'GPT 5 · subscription', model: 'gpt-5', apiKey: '' }
				],
				sharedModelId: codexId
			})
		});
		expect(put.status).toBe(200);
		const saved = await put.json();
		expect(saved.models).toHaveLength(1);
		expect(saved.models[0]).toMatchObject({ provider: 'codex', id: codexId, model: 'gpt-5' });
		expect(saved.sharedModelId).toBe(codexId);
		expect(saved.model).toBe('gpt-5');
		expect(saved.configured).toBe(true);
		expect(isReviewConfigured()).toBe(true);

		// Shared selection survives a round-trip and a second save alongside an API model.
		const apiId = 'api-1';
		const put2 = await app.request('/api/settings/models', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				models: [
					{ provider: 'codex', id: codexId, label: 'GPT 5 · subscription', model: 'gpt-5', apiKey: '' },
					{ provider: 'openai-compatible', id: apiId, label: 'Qwen', model: 'qwen/x', baseUrl: 'https://x/v1', apiKey: '' }
				],
				sharedModelId: codexId
			})
		});
		expect(put2.status).toBe(200);
		const saved2 = await put2.json();
		expect(saved2.models).toHaveLength(2);
		expect(saved2.sharedModelId).toBe(codexId);
		expect(saved2.configured).toBe(true);
	});
});
