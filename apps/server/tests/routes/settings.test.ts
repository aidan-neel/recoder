import { describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from '../../src/app';
import {
	effectiveReviewEnv,
	effectiveSubagentCap,
	effectiveTokenBudget,
	getStoredSettings,
	initReviewSettings,
	setReviewOverrides
} from '../../src/review/session/review-settings';
import { configForOrchestrator, configForSubagent, isReviewConfigured } from '../../src/models/models';
import { isolateDataDir, isolateSettings } from '../helpers/settings-env';

isolateSettings();

/** Two models on one local endpoint, for the Review and second picks. */
const LEAD_AND_WORKER = [
	{
		id: 'lead',
		label: 'Lead',
		model: 'lead-model',
		provider: 'openai-compatible',
		baseUrl: 'http://localhost:8000/v1'
	},
	{
		id: 'worker',
		label: 'Worker',
		model: 'worker-model',
		provider: 'openai-compatible',
		baseUrl: 'http://localhost:8000/v1'
	}
];

describe('review settings', () => {
	test('orchestrator and specialist models route independently and survive reload', async () => {
		const response = await app.request('/api/settings/models', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				models: LEAD_AND_WORKER,
				orchestratorModelId: 'lead',
				specialistModelId: 'worker'
			})
		});

		expect(response.status).toBe(200);
		setReviewOverrides({});
		initReviewSettings();
		expect(configForOrchestrator().model).toBe('lead-model');
		expect(configForSubagent().model).toBe('worker-model');
		expect(configForSubagent().model).toBe('worker-model');

		const settings = await (await app.request('/api/settings/models')).json();

		expect(settings.orchestratorModelId).toBe('lead');
		expect(settings.specialistModelId).toBe('worker');
	});

	test('Review and Specialist efforts persist across reload and survive a model change', async () => {
		setReviewOverrides({
			models: [
				{
					id: 'sub',
					label: 'Subscription',
					model: 'test-model',
					provider: 'openai-compatible',
					baseUrl: 'http://localhost:8000/v1'
				}
			]
		});

		const patch = await app.request('/api/settings/models', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ orchestratorEffort: 'low', specialistEffort: 'high' })
		});

		expect(patch.status).toBe(200);
		expect(await patch.json()).toMatchObject({ orchestratorEffort: 'low', specialistEffort: 'high' });
		setReviewOverrides({});
		initReviewSettings();
		expect(configForOrchestrator().reasoningEffort).toBe('low');
		expect(configForSubagent().reasoningEffort).toBe('high');

		const changedModel = await app.request('/api/settings/models', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				models: [
					{
						id: 'new',
						label: 'New',
						model: 'new-model',
						provider: 'openai-compatible',
						baseUrl: 'http://localhost:8000/v1'
					}
				]
			})
		});

		expect(changedModel.status).toBe(200);
		expect(configForSubagent()).toMatchObject({ model: 'new-model', reasoningEffort: 'high' });
	});

	test('the subagent cap persists across reload and rejects other values', async () => {
		expect((await (await app.request('/api/settings/models')).json()).subagentCap).toBe(8);

		const patch = await app.request('/api/settings/models', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ subagentCap: 0 })
		});

		expect(patch.status).toBe(200);
		expect((await patch.json()).subagentCap).toBe(0);
		setReviewOverrides({});
		initReviewSettings();
		expect(effectiveSubagentCap()).toBe(0);

		const bad = await app.request('/api/settings/models', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ subagentCap: 5 })
		});

		expect(bad.status).toBe(400);
		expect(effectiveSubagentCap()).toBe(0);
	});

	test('a token budget saves with the cap and efforts it sets, survives a restart, and a file from before budgets reads as Medium', async () => {
		setReviewOverrides({
			models: [
				{
					id: 'sub',
					label: 'Subscription',
					model: 'test-model',
					provider: 'openai-compatible',
					baseUrl: 'http://localhost:8000/v1'
				}
			]
		});

		expect((await (await app.request('/api/settings/models')).json()).tokenBudget).toBe('medium');

		const patch = await app.request('/api/settings/models', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ tokenBudget: 'low', subagentCap: 3, orchestratorEffort: 'low', specialistEffort: 'low' })
		});

		expect(await patch.json()).toMatchObject({
			tokenBudget: 'low',
			subagentCap: 3,
			orchestratorEffort: 'low',
			specialistEffort: 'low'
		});

		setReviewOverrides({});
		initReviewSettings();
		expect(effectiveTokenBudget()).toBe('low');
		expect(effectiveSubagentCap()).toBe(3);
		expect(configForOrchestrator().reasoningEffort).toBe('low');

		writeFileSync(join(process.env.RECODER_DATA_DIR!, 'review-config.json'), JSON.stringify({ subagentCap: 12 }));
		setReviewOverrides({});
		initReviewSettings();
		expect(effectiveTokenBudget()).toBe('medium');
		expect(effectiveSubagentCap()).toBe(12);
	});

	test('uncapped subagents save, read back and survive a restart', async () => {
		const patch = await app.request('/api/settings/models', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ subagentCap: 'uncapped' })
		});

		expect(patch.status).toBe(200);
		expect((await patch.json()).subagentCap).toBe('uncapped');
		setReviewOverrides({});
		initReviewSettings();
		expect((await (await app.request('/api/settings/models')).json()).subagentCap).toBe('uncapped');
	});

	test('invalid effort values are rejected without changing settings', async () => {
		setReviewOverrides({ specialistEffort: 'high' });

		for (const specialistEffort of ['ultra', '', 1, [], {}]) {
			const res = await app.request('/api/settings/models', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ specialistEffort })
			});

			expect(res.status).toBe(400);
			expect(getStoredSettings().specialistEffort).toBe('high');
		}
	});

	test('a saved file with per-role picks loads as one Specialist pick', async () => {
		const legacy = (extra: object) =>
			writeFileSync(
				join(process.env.RECODER_DATA_DIR!, 'review-config.json'),
				JSON.stringify({
					models: LEAD_AND_WORKER,
					orchestratorModelId: 'lead',
					roles: { correctness: 'worker', security: 'lead' },
					roleEfforts: { correctness: 'high', docs: 'low' },
					...extra
				})
			);

		legacy({});
		initReviewSettings();

		expect(getStoredSettings()).toMatchObject({
			specialistModelId: 'worker',
			specialistEffort: 'high',
			orchestratorEffort: 'high'
		});

		expect(getStoredSettings()).not.toHaveProperty('roles');
		expect(configForSubagent()).toMatchObject({ model: 'worker-model', reasoningEffort: 'high' });
		setReviewOverrides({});
		legacy({ applyToSpecialists: true });
		initReviewSettings();
		expect(getStoredSettings().specialistModelId).toBeUndefined();
		expect(configForSubagent().model).toBe('lead-model');
	});

	test('PUT stores the model registry and no response returns the key', async () => {
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
		expect(saved.apiKeySet).toBe(true);
		expect(JSON.stringify(saved)).not.toContain('secret1234');
		expect(saved.sharedModelId).toBe('m1');

		const get = await app.request('/api/settings/models');
		const body = await get.json();

		expect(body.baseUrl).toBe('https://openrouter.ai/api/v1');
		expect(body.model).toBe('qwen/qwen-2.5-coder-32b-instruct');

		const stored = getStoredSettings().models ?? [];

		expect(stored).toHaveLength(2);
		expect(stored[0]).toMatchObject({ id: 'm1', label: 'Qwen coder' });
		expect(typeof stored[1].id).toBe('string');
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
});

test('a disconnect during a pending connect stays final', async () => {
	const realFetch = globalThis.fetch;
	let finishVerify!: () => void;

	globalThis.fetch = (() =>
		new Promise((resolve) => {
			finishVerify = () => resolve(Response.json({ data: [] }));
		})) as unknown as typeof fetch;

	try {
		const connecting = app.request('/api/settings/providers/opencode-go/connect', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ apiKey: 'sk-late' })
		});

		await new Promise((resolve) => setTimeout(resolve, 10));
		expect((await app.request('/api/settings/providers/opencode-go', { method: 'DELETE' })).status).toBe(200);
		finishVerify();
		expect((await connecting).status).toBe(409);
		expect(getStoredSettings().connections?.['opencode-go']).toBeUndefined();
	} finally {
		globalThis.fetch = realFetch;
	}
});
