import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ReasoningEffort, TokenUsage } from '@recoder/shared';
import { CopilotAgent } from '../../../src/agents/copilot/copilot';
import type { ChatOptions } from '../../../src/models/llm/types';
import { COPILOT_FAILURES, fakeCopilot } from '../../helpers/fake-copilot';
import { testCallFailures } from '../../helpers/native-agent';

function chat(overrides: Partial<ChatOptions> = {}): ChatOptions {
	return {
		provider: 'copilot',
		baseUrl: '',
		apiKey: '',
		model: 'gpt-5.6-sol',
		messages: [
			{ role: 'system', content: 'Review the diff.' },
			{ role: 'user', content: 'diff --git a/x b/x' }
		],
		...overrides
	};
}

/** What the fake logged for one call, and the environment its process ran with. */
const loggedSchema = z.object({
	call: z.object({
		args: z.array(z.string()),
		prompt: z.string(),
		home: z.string(),
		settings: z.string()
	}),
	childEnv: z.record(z.string(), z.string())
});

/** What the fake logged for one call of `env`, with that call's environment beside it. */
async function logged(env: Record<string, string | undefined>): Promise<z.infer<typeof loggedSchema>> {
	const log = env.FAKE_COPILOT_LOG ?? '';

	return loggedSchema.parse({
		call: JSON.parse(await readFile(log, 'utf8')),
		childEnv: JSON.parse(await readFile(`${log}.env`, 'utf8'))
	});
}

/** The value that follows `flag` in a call's arguments. */
function after(args: string[], flag: string): string | undefined {
	return args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
}

test('the fixed models are the ids copilot help config documents, each but auto offered the CLI’s effort levels', async () => {
	const agent = new CopilotAgent(await fakeCopilot());
	const efforts: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
	const models = await agent.models();

	expect(models).toHaveLength(28);

	expect(models[0]).toMatchObject({
		id: 'copilot:auto',
		provider: 'copilot',
		model: 'auto',
		label: 'Auto (Copilot picks)',
		baseUrl: null,
		apiKeyPreview: null,
		contextWindow: 200_000
	});

	expect(models[0]).not.toHaveProperty('efforts');
	expect(models[0]).not.toHaveProperty('defaultEffort');

	for (const entry of models.slice(1)) expect(entry).toMatchObject({ efforts, defaultEffort: 'medium' });

	expect(models.map((entry) => entry.model)).toContain('claude-sonnet-5.5');
	expect(models.map((entry) => entry.model)).toContain('gpt-6.1-sol');
	expect(models.every((entry) => entry.id === `copilot:${entry.model}`)).toBe(true);

	expect(agent.fixedModels()).toEqual(models);
});

describe('CopilotAgent.complete', () => {
	test('streams the reply, runs with its own tools off and the server keys stripped, and counts the usage', async () => {
		const env = await fakeCopilot({ RECODER_SECRET_KEY: 'k', COPILOT_MODEL: 'other', GH_TOKEN: 't' });
		const tokens: string[] = [];
		let usage: TokenUsage | undefined;

		const reply = await new CopilotAgent(env).complete(chat({ onUsage: (u) => (usage = u) }), (t) => tokens.push(t));

		const { call, childEnv } = await logged(env);

		expect(reply).toBe('the reply');
		expect(tokens.join('')).toBe(reply);
		expect(after(call.args, '--deny-tool')).toBe('shell,write,read,url,memory');
		expect(call.args).toContain('--disable-builtin-mcps');
		expect(call.args).not.toContain('--additional-mcp-config');
		expect(after(call.args, '--available-tools')).toBe('recoder-no-tools');
		expect(after(call.args, '--secret-env-vars')).toBe('COPILOT_GITHUB_TOKEN');
		expect(after(call.args, '--model')).toBe('gpt-5.6-sol');
		expect(call.args).toContain('--usage-output-file');
		expect(call.prompt).toContain('Review the diff.');
		expect(call.prompt).toContain('diff --git a/x b/x');
		expect(childEnv.GH_TOKEN).toBeUndefined();
		expect(childEnv.COPILOT_MODEL).toBeUndefined();
		expect(childEnv.RECODER_SECRET_KEY).toBeUndefined();
		expect(childEnv.COPILOT_AUTO_UPDATE).toBe('false');

		expect(usage).toMatchObject({
			inputTokens: 1000,
			outputTokens: 20,
			totalTokens: 1020,
			cachedInputTokens: 600,
			cacheWriteInputTokens: 5
		});
	});

	test('only COPILOT_GITHUB_TOKEN crosses to the CLI; the server’s forge tokens stay behind', async () => {
		const env = await fakeCopilot({
			GH_TOKEN: 'forge-gh',
			GITHUB_TOKEN: 'forge-github',
			COPILOT_GITHUB_TOKEN: 'copilot-token',
			XDG_CONFIG_HOME: '/xdg/config',
			GH_CONFIG_DIR: '/gh/config'
		});

		await new CopilotAgent(env).complete(chat());

		const { childEnv } = await logged(env);
		const { HOME, PATH } = env;

		if (HOME === undefined || PATH === undefined) throw new Error('the fake env has no HOME or PATH');

		expect(childEnv.COPILOT_GITHUB_TOKEN).toBe('copilot-token');
		expect(childEnv.GH_TOKEN).toBeUndefined();
		expect(childEnv.GITHUB_TOKEN).toBeUndefined();
		expect(childEnv.HOME).toBe(HOME);
		expect(childEnv.PATH).toBe(PATH);
		expect(childEnv.XDG_CONFIG_HOME).toBe('/xdg/config');
		expect(childEnv.GH_CONFIG_DIR).toBe('/gh/config');
	});

	test('passes the picked effort as --reasoning-effort, none when the request names none, and none for auto', async () => {
		const env = await fakeCopilot();
		const agent = new CopilotAgent(env);

		await agent.complete(chat({ reasoningEffort: 'high' }));
		await agent.complete(chat());
		await agent.complete(chat({ model: 'auto', reasoningEffort: 'high' }));

		const lines = (await readFile(env.FAKE_COPILOT_LOG ?? '', 'utf8')).trim().split('\n');

		const [picked, unpicked, auto] = lines.map((line) =>
			z.object({ args: z.array(z.string()) }).parse(JSON.parse(line))
		);

		expect(after(picked.args, '--reasoning-effort')).toBe('high');
		expect(unpicked.args).not.toContain('--reasoning-effort');
		expect(auto.args).not.toContain('--reasoning-effort');
	});

	test('leaves the session the call saved and its scratch COPILOT_HOME deleted', async () => {
		const env = await fakeCopilot();

		await new CopilotAgent(env).complete(chat());

		const { call } = await logged(env);

		expect(call.home).toBeTruthy();
		expect(existsSync(call.home)).toBe(false);
	});

	testCallFailures(
		async (mode) => new CopilotAgent(await fakeCopilot({ FAKE_COPILOT_MODE: mode })).complete(chat()),
		COPILOT_FAILURES
	);
});

test('detect reports the version and leaves sign-in unknown, since the CLI has no status command', async () => {
	const status = await new CopilotAgent(await fakeCopilot()).detect();

	expect(status).toMatchObject({
		id: 'copilot',
		name: 'GitHub Copilot',
		installed: true,
		version: '1.0.109',
		signedIn: null
	});
});

test('a VS Code shim on PATH is not taken for the CLI', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'copilot-shim-'));
	const shim = join(dir, 'copilot');

	await mkdir(dir, { recursive: true });

	await writeFile(
		shim,
		'#!/usr/bin/env sh\n# vscode-copilot-launcher: forwards to the editor\nexec copilot.exe "$@"\n',
		{
			mode: 0o755
		}
	);

	const agent = new CopilotAgent({ PATH: `${dir}:${process.env.PATH ?? ''}` });

	expect(agent.installed()).toBe(false);
	expect((await agent.detect()).installed).toBe(false);
});

test('the picked effort is what a model runs at, auto takes none, and with none picked the model keeps its own default', () => {
	const agent = new CopilotAgent();

	expect(agent.modelSettings('gpt-5.6-sol', 'medium')).toEqual({ reasoningEffort: 'medium' });
	expect(agent.modelSettings('gpt-5.6-sol', 'max')).toEqual({ reasoningEffort: 'max' });
	expect(agent.modelSettings('gpt-5.6-sol', undefined)).toEqual({});
	expect(agent.modelSettings('auto', 'high')).toEqual({});
});
