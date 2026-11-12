import { describe, expect, jest, spyOn, test } from 'bun:test';
import type { ModelEntry, ModelSettings, SetupStatus } from '@recoder/shared';
import { claudeCode } from '../../src/agents/claude-code/claude-code';
import { copilot } from '../../src/agents/copilot/copilot';
import { devin } from '../../src/agents/devin/devin';
import { opencode } from '../../src/agents/opencode/opencode';
import { forgetAgentModels } from '../../src/agents/registry';
import { app } from '../../src/app';
import { db } from '../../src/store';
import { isReviewConfigured } from '../../src/models/models';
import { setReviewOverrides } from '../../src/review/session/review-settings';
import { isolateSettings } from '../helpers/settings-env';

isolateSettings();

describe('setup status', () => {
	const model: ModelEntry = { id: 'sonnet', label: 'Sonnet', model: 'sonnet', baseUrl: null, apiKeyPreview: null };
	let offered: ModelEntry[] = [];

	/** Claude Code lists exactly `offered`, the other agents nothing; OpenCode reads as missing, and no CLI runs. */
	const spies = () => [
		spyOn(claudeCode, 'models').mockImplementation(async () => offered),
		spyOn(copilot, 'models').mockResolvedValue([]),
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
