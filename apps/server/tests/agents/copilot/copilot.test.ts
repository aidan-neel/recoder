import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ReasoningEffort, TokenUsage } from '@recoder/shared';
import { CopilotAgent } from '../../../src/agents/copilot/copilot';
import { LlmError, UsageLimitError } from '../../../src/models/llm/errors';
import type { ChatOptions } from '../../../src/models/llm/types';
import { fakeCopilot } from '../../helpers/fake-copilot';

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

test('the fixed models are the ids copilot help config documents, each offered the CLI’s effort levels', async () => {
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
		contextWindow: 200_000,
		efforts,
		defaultEffort: 'medium'
	});

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
		expect(after(call.args, '--model')).toBe('gpt-5.6-sol');
		expect(call.args).toContain('--usage-output-file');
		expect(call.prompt).toContain('Review the diff.');
		expect(call.prompt).toContain('diff --git a/x b/x');
		expect(childEnv.GH_TOKEN).toBe('t');
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

	test('passes the picked effort as --reasoning-effort and none when the request names none', async () => {
		const env = await fakeCopilot();
		const agent = new CopilotAgent(env);

		await agent.complete(chat({ reasoningEffort: 'high' }));
		await agent.complete(chat());

		const lines = (await readFile(env.FAKE_COPILOT_LOG ?? '', 'utf8')).trim().split('\n');
		const [picked, unpicked] = lines.map((line) => z.object({ args: z.array(z.string()) }).parse(JSON.parse(line)));

		expect(after(picked.args, '--reasoning-effort')).toBe('high');
		expect(unpicked.args).not.toContain('--reasoning-effort');
	});

	test('leaves the session the call saved and its scratch COPILOT_HOME deleted', async () => {
		const env = await fakeCopilot();

		await new CopilotAgent(env).complete(chat());

		const { call } = await logged(env);

		expect(call.home).toBeTruthy();
		expect(existsSync(call.home)).toBe(false);
	});

	test.each([
		['auth', 401, /copilot login/],
		['limit', 429, /resets at 3pm/],
		['crash', 0, /boom/]
	] as const)('a %s call fails as an LlmError with status %d', async (mode, status, message) => {
		const error = await new CopilotAgent(await fakeCopilot({ FAKE_COPILOT_MODE: mode }))
			.complete(chat())
			.catch((e: unknown) => e);

		if (!(error instanceof LlmError)) throw new Error(`expected LlmError, got ${String(error)}`);

		expect(error.status).toBe(status);
		expect(error.message).toMatch(message);
	});

	test('a usage-cap failure is a UsageLimitError, which the app reports as out of usage', async () => {
		const error = await new CopilotAgent(await fakeCopilot({ FAKE_COPILOT_MODE: 'limit' }))
			.complete(chat())
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(UsageLimitError);
	});
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

test('the picked effort is what a model runs at, and with none picked the model keeps its own default', () => {
	const agent = new CopilotAgent();

	expect(agent.modelSettings('gpt-5.6-sol', 'medium')).toEqual({ reasoningEffort: 'medium' });
	expect(agent.modelSettings('gpt-5.6-sol', 'max')).toEqual({ reasoningEffort: 'max' });
	expect(agent.modelSettings('gpt-5.6-sol', undefined)).toEqual({});
});
