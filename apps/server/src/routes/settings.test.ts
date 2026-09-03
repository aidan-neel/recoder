import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../app';
import { effectiveReviewEnv, setReviewOverrides } from '../lib/review-settings';
import { isReviewConfigured } from '../lib/models';

const ENV_KEYS = [
	'RECODER_REVIEW_BASE_URL',
	'RECODER_REVIEW_API_KEY',
	'RECODER_REVIEW_MODEL',
	'RECODER_SECURITY_MODEL'
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (savedEnv[k] === undefined) delete process.env[k];
		else process.env[k] = savedEnv[k];
	}
	setReviewOverrides({});
	delete process.env.RECODER_DATA_DIR;
});

function isolateDataDir(): void {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-settings-'));
}

describe('review settings', () => {
	test('unconfigured by default', async () => {
		for (const k of ENV_KEYS) delete process.env[k];
		expect(isReviewConfigured()).toBe(false);
		const res = await app.request('/api/settings/models');
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.configured).toBe(false);
		expect(body.apiKeyPreview).toBeNull();
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
				sharedModelId: 'm1',
				roles: { security: 'm1' }
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
		expect(body.roles.security).toBe('m1');
		expect(body.roles.perf).toBeNull();
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

	test('PUT validates input', async () => {
		const res = await app.request('/api/settings/models', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ maxFiles: -3 })
		});
		expect(res.status).toBe(400);
	});
});
