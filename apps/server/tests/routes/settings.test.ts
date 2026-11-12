import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelEntry, ModelSettings, SetupStatus } from '@recoder/shared';
import { claudeCode } from '../../src/agents/claude-code/claude-code';
import { devin } from '../../src/agents/devin/devin';
import { opencode } from '../../src/agents/opencode/opencode';
import { forgetAgentModels } from '../../src/agents/registry';
import { app } from '../../src/app';
import { db } from '../../src/store';
import {
	effectiveReviewEnv,
	effectiveSubagentCap,
	getStoredSettings,
	initReviewSettings,
	setReviewOverrides
} from '../../src/review/session/review-settings';
import { configForOrchestrator, configForSubagent, isReviewConfigured } from '../../src/models/models';

const ENV_KEYS = ['RECODER_REVIEW_BASE_URL', 'RECODER_REVIEW_API_KEY', 'RECODER_REVIEW_MODEL', 'RECODER_DATA_DIR'];
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
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				models: [
					{ id: 'lead', label: 'Lead', model: 'lead-model', provider: 'codex' },
					{ id: 'worker', label: 'Worker', model: 'worker-model', provider: 'codex' }
				],
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
		setReviewOverrides({ models: [{ id: 'sub', label: 'Subscription', model: 'test-model', provider: 'codex' }] });

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
			body: JSON.stringify({ models: [{ id: 'new', label: 'New', model: 'new-model', provider: 'codex' }] })
		});

		expect(changedModel.status).toBe(200);
		expect(configForSubagent()).toMatchObject({ model: 'new-model', reasoningEffort: 'high' });
	});

	test('the subagent cap persists across reload and rejects other values', async () => {
		expect((await (await app.request('/api/settings/models')).json()).subagentCap).toBe(2);

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
			body: JSON.stringify({ subagentCap: 3 })
		});

		expect(bad.status).toBe(400);
		expect(effectiveSubagentCap()).toBe(0);
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
					models: [
						{ id: 'lead', label: 'Lead', model: 'lead-model', provider: 'codex' },
						{ id: 'worker', label: 'Worker', model: 'worker-model', provider: 'codex' }
					],
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

	test('PUT stores the model registry and GET masks the key', async () => {
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

	test('codex subscription model is listed, selectable as shared, and stays selected beside an API model', async () => {
		isolateDataDir();

		const codexId = 'codex-shared-1';

		const put = await app.request('/api/settings/models', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				models: [{ provider: 'codex', id: codexId, label: 'GPT 5 · subscription', model: 'gpt-5', apiKey: '' }],
				sharedModelId: codexId
			})
		});

		expect(put.status).toBe(200);

		const saved = await put.json();

		expect(getStoredSettings().models).toHaveLength(1);
		expect(getStoredSettings().models?.[0]).toMatchObject({ provider: 'codex', id: codexId, model: 'gpt-5' });
		expect(saved.sharedModelId).toBe(codexId);
		expect(saved.model).toBe('gpt-5');
		expect(saved.configured).toBe(true);
		expect(isReviewConfigured()).toBe(true);

		const apiId = 'api-1';

		const put2 = await app.request('/api/settings/models', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				models: [
					{ provider: 'codex', id: codexId, label: 'GPT 5 · subscription', model: 'gpt-5', apiKey: '' },
					{
						provider: 'openai-compatible',
						id: apiId,
						label: 'Qwen',
						model: 'qwen/x',
						baseUrl: 'https://x/v1',
						apiKey: ''
					}
				],
				sharedModelId: codexId
			})
		});

		expect(put2.status).toBe(200);

		const saved2 = await put2.json();

		expect(getStoredSettings().models).toHaveLength(2);
		expect(saved2.sharedModelId).toBe(codexId);
		expect(saved2.configured).toBe(true);
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

describe('setup status', () => {
	const model: ModelEntry = { id: 'sonnet', label: 'Sonnet', model: 'sonnet', baseUrl: null, apiKeyPreview: null };
	let offered: ModelEntry[] = [];

	/** Every agent lists exactly `offered`, OpenCode reads as missing, and no CLI runs. */
	const spies = () => [
		spyOn(claudeCode, 'models').mockImplementation(async () => offered),
		spyOn(opencode, 'models').mockResolvedValue([]),
		spyOn(opencode, 'detect').mockResolvedValue({
			id: 'opencode',
			name: 'OpenCode',
			installed: false,
			version: null,
			path: null,
			error: null,
			install: '',
			signedIn: null,
			login: null,
			providers: true
		}),
		spyOn(devin, 'models').mockResolvedValue([])
	];

	const status = async () => (await (await app.request('/api/settings/status')).json()) as SetupStatus;

	/** Lets every promise already settled run its handlers, while fake timers hold the clock. */
	const flushTasks = async () => {
		for (let turn = 0; turn < 50; turn++) await Promise.resolve();
	};

	test('counts the models and repositories without sending the model catalog', async () => {
		const mocks = spies();

		offered = [model];
		forgetAgentModels();

		expect(await status()).toEqual({
			configured: isReviewConfigured(),
			modelCount: 1,
			providerConnected: true,
			repoCount: db.repos.list().length
		});

		for (const mock of mocks) mock.mockRestore();
		forgetAgentModels();
	});

	test('an agent whose listing hangs holds the status two seconds at most, and the other agents’ models still count', async () => {
		const mocks = spies();

		spyOn(devin, 'models').mockImplementation(() => new Promise(() => {}));

		offered = [model];
		forgetAgentModels();
		jest.useFakeTimers();

		try {
			let answered: SetupStatus | null = null;

			void status().then((answer) => (answered = answer));
			await flushTasks();
			expect(answered).toBeNull();

			jest.advanceTimersByTime(2_000);
			await flushTasks();
			expect(answered).toMatchObject({ modelCount: 1, providerConnected: true });
		} finally {
			jest.useRealTimers();
			for (const mock of mocks) mock.mockRestore();
			forgetAgentModels();
		}
	});

	test('the model list stays cached through a settings save and a hosted key change, until an agent provider changes', async () => {
		const mocks = [
			...spies(),
			spyOn(opencode, 'remove').mockResolvedValue(undefined),
			spyOn(opencode, 'providers').mockResolvedValue([])
		];

		offered = [];
		forgetAgentModels();
		expect((await status()).modelCount).toBe(0);

		offered = [model];
		expect((await status()).modelCount).toBe(0);

		await app.request('/api/settings/models', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ reportLowSeverity: true })
		});

		expect((await status()).modelCount).toBe(0);

		await app.request('/api/settings/providers/opencode-go', { method: 'DELETE' });
		expect((await status()).modelCount).toBe(0);

		await app.request('/api/agent/providers/anthropic', { method: 'DELETE' });
		expect((await status()).modelCount).toBe(1);

		for (const mock of mocks) mock.mockRestore();
		forgetAgentModels();
	});
});

describe('settings without the catalog', () => {
	const entry = (name: string): ModelEntry => ({
		id: `claude-code:${name}`,
		label: name,
		model: name,
		baseUrl: null,
		apiKeyPreview: null,
		efforts: ['low', 'high']
	});

	const [sonnet, opus] = [entry('sonnet'), entry('opus')];
	let offered: ModelEntry[] = [];

	const read = async (query = '') =>
		(await (await app.request(`/api/settings/models${query}`)).json()) as ModelSettings;

	const patch = (body: object) =>
		app.request('/api/settings/models?catalog=0', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});

	/** Claude Code offers `offered`, the other agents nothing; Devin's spy is first, to see whether it was asked. */
	const spies = () => [
		spyOn(devin, 'models').mockResolvedValue([]),
		spyOn(claudeCode, 'models').mockImplementation(async () => offered),
		spyOn(opencode, 'models').mockResolvedValue([])
	];

	test('the picks answer is the full answer with only the picked models, and asks only the agents that run them', async () => {
		const mocks = spies();

		offered = [sonnet, opus];
		forgetAgentModels();
		setReviewOverrides({ orchestratorModelId: sonnet.id, specialistModelId: 'opencode:gone/model' });

		const picks = await read('?catalog=0');

		expect(picks.models).toEqual([{ ...sonnet, agent: 'Claude Code' }]);
		expect(mocks[0]).not.toHaveBeenCalled();
		expect({ ...(await read()), models: picks.models }).toEqual(picks);

		for (const mock of mocks) mock.mockRestore();
		forgetAgentModels();
	});

	test('a save answers with its picks from the cached model list, without asking the agent again', async () => {
		const mocks = spies();

		offered = [sonnet];
		forgetAgentModels();
		expect((await read('?catalog=0')).models).toEqual([]);

		const saved = (await (await patch({ orchestratorModelId: sonnet.id })).json()) as ModelSettings;

		expect(saved.models.map((model) => model.id)).toEqual([sonnet.id]);

		offered = [{ ...sonnet, label: 'Sonnet 5' }];

		const resaved = (await (await patch({ reportLowSeverity: true })).json()) as ModelSettings;

		expect(resaved.models[0].label).toBe('sonnet');
		expect(mocks[1]).toHaveBeenCalledTimes(1);

		for (const mock of mocks) mock.mockRestore();
		forgetAgentModels();
	});
});
