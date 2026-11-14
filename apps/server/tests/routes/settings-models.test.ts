import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from 'bun:test';
import type { AgentProvider, AgentStatus, ModelEntry, ModelSettings, SetupStatus } from '@recoder/shared';
import { claudeCode } from '../../src/agents/claude-code/claude-code';
import { copilot } from '../../src/agents/copilot/copilot';
import { devin } from '../../src/agents/devin/devin';
import { opencode } from '../../src/agents/opencode/opencode';
import { forgetAgentModels } from '../../src/agents/registry';
import { app } from '../../src/app';
import { db } from '../../src/store';
import { configForOrchestrator, isReviewConfigured } from '../../src/models/models';
import { initReviewSettings, setReviewOverrides } from '../../src/review/session/review-settings';
import { claudeCodeModel } from '../helpers/model-entries';
import { isolateSettings } from '../helpers/settings-env';

isolateSettings();

/** OpenCode as it reads on a machine without it. */
const MISSING_OPENCODE: AgentStatus = {
	id: 'opencode',
	name: 'OpenCode',
	installed: false,
	version: null,
	path: null,
	error: null,
	install: '',
	signedIn: null,
	login: null,
	providers: true,
	config: null,
	setup: { install: false, signIn: false }
};

const read = async (query = '') => (await (await app.request(`/api/settings/models${query}`)).json()) as ModelSettings;

const status = async () => (await (await app.request('/api/settings/status')).json()) as SetupStatus;

/** Saves `body` through the settings route; `query` shapes the answer, as for {@link read}. */
const patch = (body: object, query = '') =>
	app.request(`/api/settings/models${query}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});

describe('setup status', () => {
	const model: ModelEntry = { id: 'sonnet', label: 'Sonnet', model: 'sonnet', baseUrl: null, apiKeySet: false };
	let offered: ModelEntry[] = [];

	/** Claude Code lists exactly `offered`, the other agents nothing; OpenCode reads as missing, and no CLI runs. */
	const spies = () => [
		spyOn(claudeCode, 'models').mockImplementation(async () => offered),
		spyOn(copilot, 'models').mockResolvedValue([]),
		spyOn(opencode, 'models').mockResolvedValue([]),
		spyOn(opencode, 'detect').mockResolvedValue(MISSING_OPENCODE),
		spyOn(devin, 'models').mockResolvedValue([])
	];

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
			repoCount: (await db.repos.list()).length
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

		await patch({ reportLowSeverity: true });
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
	const [sonnet, opus] = [claudeCodeModel('sonnet'), claudeCodeModel('opus')];
	let offered: ModelEntry[] = [];

	const patchPicks = (body: object) => patch(body, '?catalog=0');

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

		const saved = (await (await patchPicks({ orchestratorModelId: sonnet.id })).json()) as ModelSettings;

		expect(saved.models.map((model) => model.id)).toEqual([sonnet.id]);

		offered = [{ ...sonnet, label: 'Sonnet 5' }];

		const resaved = (await (await patchPicks({ reportLowSeverity: true })).json()) as ModelSettings;

		expect(resaved.models[0].label).toBe('sonnet');
		expect(mocks[1]).toHaveBeenCalledTimes(1);

		for (const mock of mocks) mock.mockRestore();
		forgetAgentModels();
	});

	test('verifierModelId and verifierEffort save through the settings route and ?catalog=0 includes the picked verifier model', async () => {
		const mocks = spies();

		offered = [sonnet, opus];
		forgetAgentModels();

		const saved = (await (
			await patchPicks({
				orchestratorModelId: sonnet.id,
				verifierModelId: opus.id,
				verifierEffort: 'high'
			})
		).json()) as ModelSettings;

		expect(saved.verifierModelId).toBe(opus.id);
		expect(saved.verifierEffort).toBe('high');
		expect(saved.models.map((entry) => entry.id)).toEqual([sonnet.id, opus.id]);

		for (const mock of mocks) mock.mockRestore();
		forgetAgentModels();
	});
});

describe('provider switches', () => {
	const REVIEW_ENV = ['RECODER_REVIEW_BASE_URL', 'RECODER_REVIEW_API_KEY', 'RECODER_REVIEW_MODEL'];

	const agentModel = (id: string): ModelEntry => ({
		id,
		label: id,
		model: id.slice(id.indexOf(':') + 1),
		baseUrl: null,
		apiKeySet: false
	});

	const connectedProvider = (id: string): AgentProvider => ({
		id,
		name: id,
		modelCount: 0,
		connected: true,
		via: 'key',
		removable: true,
		methods: []
	});

	const [sonnet, anthropic, openrouter] = [
		'claude-code:sonnet',
		'opencode:anthropic/claude-sonnet',
		'opencode:openrouter/qwen/qwen3'
	].map(agentModel);

	let mocks: { mockRestore(): void }[] = [];

	/**
	 * Claude Code lists Sonnet; OpenCode runs, lists a model of Anthropic and one of OpenRouter, and has those two and
	 * its free Zen tier (`opencode`, no models listed) connected; the other agents list nothing. No CLI runs.
	 */
	beforeEach(() => {
		for (const key of REVIEW_ENV) delete process.env[key];

		mocks = [
			spyOn(claudeCode, 'models').mockResolvedValue([sonnet]),
			spyOn(opencode, 'models').mockResolvedValue([anthropic, openrouter]),
			spyOn(copilot, 'models').mockResolvedValue([]),
			spyOn(devin, 'models').mockResolvedValue([]),
			spyOn(opencode, 'providers').mockResolvedValue(['anthropic', 'openrouter', 'opencode'].map(connectedProvider)),
			spyOn(opencode, 'detect').mockResolvedValue({ ...MISSING_OPENCODE, installed: true, version: '1.0.0' })
		];

		forgetAgentModels();
	});

	afterEach(() => {
		for (const mock of mocks) mock.mockRestore();
		forgetAgentModels();
	});

	const ids = (settings: ModelSettings): string[] => settings.models.map((model) => model.id);

	test('a save keeps each switched-off provider once and in order, an unknown one included, and they survive a restart', async () => {
		const saved = (await (
			await patch({ disabledProviders: ['opencode:anthropic', 'cli:uninstalled', 'opencode:anthropic'] })
		).json()) as ModelSettings;

		expect(saved.disabledProviders).toEqual(['cli:uninstalled', 'opencode:anthropic']);

		setReviewOverrides({});
		initReviewSettings();
		expect((await read()).disabledProviders).toEqual(['cli:uninstalled', 'opencode:anthropic']);
	});

	test('a provider key in neither form, or more than 200 keys, is refused and nothing is saved', async () => {
		const tooMany = Array.from({ length: 201 }, (_, index) => `cli:agent-${index}`);

		expect((await patch({ disabledProviders: ['codex'] })).status).toBe(400);
		expect((await patch({ disabledProviders: ['vllm:box'] })).status).toBe(400);
		expect((await patch({ disabledProviders: tooMany })).status).toBe(400);
		expect((await read()).disabledProviders).toEqual([]);
	});

	test('the catalog and the picks leave out a switched-off provider’s models, and its pick runs again once it is back on', async () => {
		await patch({ orchestratorModelId: anthropic.id, specialistModelId: sonnet.id });
		await patch({ disabledProviders: ['opencode:anthropic'] });

		expect(ids(await read())).toEqual([openrouter.id, sonnet.id]);
		expect(ids(await read('?catalog=0'))).toEqual([sonnet.id]);

		const restored = (await (await patch({ disabledProviders: [] })).json()) as ModelSettings;

		expect(restored.orchestratorModelId).toBe(anthropic.id);
		expect(configForOrchestrator()).toMatchObject({ provider: 'opencode', model: 'anthropic/claude-sonnet' });
	});

	test('setup status counts only the models and OpenCode providers that are switched on', async () => {
		await patch({ disabledProviders: ['cli:claude-code', 'opencode:anthropic', 'opencode:openrouter'] });
		expect(await status()).toMatchObject({ modelCount: 0, providerConnected: true });

		await patch({
			disabledProviders: ['cli:claude-code', 'opencode:anthropic', 'opencode:opencode', 'opencode:openrouter']
		});

		expect(await status()).toMatchObject({ modelCount: 0, providerConnected: false });

		await patch({ disabledProviders: ['cli:claude-code', 'cli:opencode'] });
		expect(await status()).toMatchObject({ modelCount: 0, providerConnected: false });
	});
});
