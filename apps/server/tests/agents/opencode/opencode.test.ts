import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenCodeAgent, normalizeModels, normalizeProviders } from '../../../src/agents/opencode/opencode';

const CONFIG_PROVIDERS = {
	providers: [
		{
			id: 'openrouter',
			name: 'OpenRouter',
			source: 'api',
			key: 'sk-or-secret',
			models: {
				a: {
					id: 'a',
					name: 'Model A',
					limit: { context: 131072 },
					variants: { high: {}, none: {}, low: {}, medium: {} }
				},
				old: { id: 'old', name: 'Old', status: 'deprecated' },
				embed: { id: 'embed', name: 'Embed', capabilities: { toolcall: false } }
			}
		},
		{ id: 'openai', name: 'OpenAI', source: 'custom', models: { b: { id: 'b', name: 'B' } } },
		{ id: 'opencode', name: 'OpenCode Zen', source: 'custom', models: {} },
		{ id: 'local', name: 'Local box', source: 'config', models: { c: { id: 'c' } } }
	]
};

const AUTH = {
	openai: [
		{ type: 'oauth', label: 'ChatGPT' },
		{ type: 'api', label: 'API key' }
	],
	openrouter: [{ type: 'api', label: 'API key' }]
};

const CATALOG = [
	{ id: 'openrouter', name: 'OpenRouter', modelCount: 300 },
	{ id: 'openai', name: 'OpenAI', modelCount: 20 },
	{ id: 'opencode', name: 'OpenCode Zen', modelCount: 80 },
	{ id: 'xai', name: 'xAI', modelCount: 9 }
];

describe('normalizeProviders', () => {
	test('classifies how each provider is connected, includes config-only providers and never copies keys', () => {
		const list = normalizeProviders(CATALOG, CONFIG_PROVIDERS, AUTH);
		const by = Object.fromEntries(list.map((p) => [p.id, p]));

		expect(by.openrouter).toMatchObject({ connected: true, via: 'key', removable: true, modelCount: 1 });
		expect(by.openai).toMatchObject({ connected: true, via: 'oauth', removable: true });
		expect(by.opencode).toMatchObject({ connected: true, via: 'builtin', removable: false });
		expect(by.local).toMatchObject({ connected: true, via: 'config', removable: false, name: 'Local box' });
		expect(by.xai).toMatchObject({ connected: false, via: null, modelCount: 9 });
		expect(JSON.stringify(list)).not.toContain('sk-or-secret');
	});
});

describe('normalizeModels', () => {
	test('keeps usable models and orders their efforts from variants', () => {
		const models = normalizeModels(CONFIG_PROVIDERS);

		expect(models.map((m) => m.id)).toEqual(['opencode:openrouter/a', 'opencode:openai/b', 'opencode:local/c']);

		expect(models[0]).toMatchObject({
			efforts: ['low', 'medium', 'high'],
			defaultEffort: 'medium',
			contextWindow: 131072,
			source: 'OpenRouter'
		});

		expect(models[1].efforts).toBeUndefined();
	});
});

/** A fake `opencode` on PATH: prints a version, and `serve` runs a tiny password-checked API. */
async function fakeOpenCode(): Promise<Record<string, string | undefined>> {
	const dir = await mkdtemp(join(tmpdir(), 'fake-opencode-'));
	const bin = join(dir, 'opencode');

	await writeFile(
		bin,
		`#!/usr/bin/env bun
const [cmd] = process.argv.slice(2);
if (cmd === '--version') { console.log('1.2.3'); process.exit(0); }
let releaseCallback;
const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
	if (req.headers.get('authorization') !== 'Basic ' + btoa('opencode:' + process.env.OPENCODE_SERVER_PASSWORD)) return new Response('no', { status: 401 });
	const path = new URL(req.url).pathname;
	if (path === '/provider') return Response.json({ all: [{ id: 'openai', name: 'OpenAI', models: {} }], connected: [] });
	if (path === '/config/providers') return Response.json({ providers: [] });
	if (path === '/provider/auth') return Response.json({ openai: [{ type: 'oauth', label: 'ChatGPT' }] });
	if (path === '/provider/openai/oauth/authorize') return Response.json({ url: 'https://example.test/device', method: 'auto', instructions: 'Enter code: ABCD' });
	if (path === '/provider/openai/oauth/callback') { await new Promise((r) => (releaseCallback = r)); return Response.json(true); }
	if (path === '/test/finish-browser') { releaseCallback?.(); return Response.json(true); }
	if (path === '/global/dispose') return Response.json(true);
	return new Response('missing', { status: 404 });
} });
console.log('opencode server listening on http://127.0.0.1:' + server.port);
`
	);

	await chmod(bin, 0o755);

	return { PATH: `${dir}:${process.env.PATH ?? ''}`, HOME: dir };
}

let agent: OpenCodeAgent | null = null;

afterEach(() => {
	agent?.stop();
	agent = null;
});

describe('OpenCodeAgent', () => {
	test('reports not installed when no binary is found', async () => {
		agent = new OpenCodeAgent({ PATH: '/nonexistent', HOME: await mkdtemp(join(tmpdir(), 'home-')) });
		expect(await agent.detect()).toMatchObject({ installed: false, version: null, error: null });
	});

	test('starts the server behind a password and reads its version', async () => {
		agent = new OpenCodeAgent(await fakeOpenCode());
		expect(await agent.detect()).toMatchObject({ installed: true, version: '1.2.3', error: null });
		expect((await agent.providers()).map((p) => p.id)).toEqual(['openai']);
	});

	test('a browser sign-in stays pending until OpenCode finishes it', async () => {
		agent = new OpenCodeAgent(await fakeOpenCode());

		const attempt = await agent.startOAuth('openai', 0);

		expect(attempt).toMatchObject({ mode: 'auto', instructions: 'Enter code: ABCD' });
		expect(agent.attempt(attempt.attemptId)).toEqual({ status: 'pending' });
		await agent.request('/test/finish-browser');
		for (let i = 0; i < 50 && agent.attempt(attempt.attemptId)?.status === 'pending'; i++) await Bun.sleep(10);
		expect(agent.attempt(attempt.attemptId)).toEqual({ status: 'complete' });
	});
});
