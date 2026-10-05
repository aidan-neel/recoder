import { expect, test } from 'bun:test';
import type { OpenCodeAgent } from '../../../../src/agents/opencode/opencode';
import { useFakeOpenCodeV2 } from '../../../helpers/fake-opencode-v2';

const start = useFakeOpenCodeV2();

async function paths(target: OpenCodeAgent): Promise<string[]> {
	return ((await target.request('/test/calls')) as { method: string; path: string }[]).map(
		(c) => `${c.method} ${c.path}`
	);
}

test('lists the connected models with the efforts their variants offer', async () => {
	const target = await start();

	expect(await target.models()).toEqual([
		expect.objectContaining({ model: 'openai/m', source: 'OpenAI', efforts: ['high'], contextWindow: 1000 })
	]);
});

test('shows a sign-in as connected, and a key method with its form fields', async () => {
	const target = await start();
	const providers = await target.providers();

	expect(providers.find((p) => p.id === 'openai')).toMatchObject({
		connected: true,
		via: 'oauth',
		removable: true,
		methods: [
			{
				index: 0,
				type: 'api',
				prompts: [{ type: 'text', key: 'resourceName', message: 'Resource Name', placeholder: 'my-models' }]
			},
			{ index: 1, type: 'oauth', label: 'ChatGPT' }
		]
	});
});

test('saves a key and removes a login through the integration routes', async () => {
	const target = await start();

	await target.setKey('openai', 'sk-test', { resourceName: 'x' });
	await target.remove('openai');

	const log = (await target.request('/test/calls')) as { method: string; path: string; body: unknown }[];

	expect(log.find((c) => c.path === '/api/integration/openai/connect/key')?.body).toEqual({
		key: 'sk-test',
		answer: { resourceName: 'x' }
	});

	expect(await paths(target)).toContain('DELETE /api/credential/cred_1');
});

test('a browser sign-in completes once OpenCode reports the attempt done', async () => {
	const target = await start();
	const attempt = await target.startOAuth('openai', 1);

	expect(attempt).toMatchObject({ url: 'https://example.test/device', mode: 'auto' });

	for (let i = 0; i < 60 && target.attempt(attempt.attemptId)?.status === 'pending'; i++) await Bun.sleep(100);

	expect(target.attempt(attempt.attemptId)).toEqual({ status: 'complete' });
});
