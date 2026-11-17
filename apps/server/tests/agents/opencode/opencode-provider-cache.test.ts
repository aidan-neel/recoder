import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { OpenCodeAgent } from '../../../src/agents/opencode/opencode';
import { OpenCodeServer } from '../../../src/agents/opencode/opencode-server';
import type { OpenCodeApi } from '../../../src/agents/opencode/api/types';
import { clearAllCaches } from '../../../src/util/ttl-cache';

const agents: OpenCodeAgent[] = [];

afterEach(() => {
	for (const agent of agents.splice(0)) agent.stop();
	mock.restore();
	clearAllCaches();
});

function fixture() {
	let connected = false;

	const read = mock(async () => ({
		providers: connected ? [{ id: 'openai', name: 'OpenAI', source: 'api', models: {} }] : []
	}));

	const api = {
		providers: async () => ({ all: [{ id: 'openai', name: 'OpenAI', models: {} }], connected: [] }),
		connected: read,
		authMethods: async () => ({}),
		setKey: async () => {
			connected = true;
		},
		removeLogin: async () => {
			connected = false;
		},
		startOAuth: async () => ({
			url: 'https://test.invalid',
			mode: 'code',
			instructions: '',
			finish: async () => {
				connected = true;

				return true;
			}
		})
	} as unknown as OpenCodeApi;

	spyOn(OpenCodeServer.prototype, 'api').mockResolvedValue(api);

	const agent = new OpenCodeAgent({ PATH: '/nonexistent' });

	agents.push(agent);

	return { agent, read };
}

test('concurrent provider reads share the connected-provider request', async () => {
	const { agent, read } = fixture();

	await Promise.all([agent.providers(), agent.providers()]);
	await agent.providers();
	expect(read).toHaveBeenCalledTimes(1);
});

test('adding and removing a key invalidates the provider list', async () => {
	const { agent } = fixture();

	expect((await agent.providers())[0].connected).toBe(false);
	await agent.setKey('openai', 'fake-key');
	expect((await agent.providers())[0].connected).toBe(true);
	await agent.remove('openai');
	expect((await agent.providers())[0].connected).toBe(false);
});

test('completing OAuth invalidates the provider list', async () => {
	const { agent } = fixture();

	expect((await agent.providers())[0].connected).toBe(false);

	const attempt = await agent.startOAuth('openai', 0);

	await agent.submitCode(attempt.attemptId, 'fake-code');
	expect((await agent.providers())[0].connected).toBe(true);
});
