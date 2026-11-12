import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { TokenUsage } from '@recoder/shared';
import { CodexAgent } from '../../../src/agents/codex/codex';
import { LlmError, UsageLimitError } from '../../../src/models/llm/errors';
import type { ChatOptions } from '../../../src/models/llm/types';
import { fakeCodex } from '../../helpers/fake-codex';

function call(overrides: Partial<ChatOptions> = {}): ChatOptions {
	return {
		provider: 'codex',
		baseUrl: '',
		apiKey: '',
		model: 'gpt-6-sol',
		messages: [
			{ role: 'system', content: 'Review the diff.' },
			{ role: 'user', content: 'diff --git a/x b/x' }
		],
		...overrides
	};
}

/** The one call the fake logged: its argv, prompt, system prompt and the sub-agent version its model was offered. */
async function loggedCall(
	log: string | undefined
): Promise<{ args: string[]; prompt: string; system: string; subagents: string | null }> {
	return JSON.parse((await readFile(log ?? '', 'utf8')).trim());
}

test('the models are the catalog’s listed ones, with the effort levels Recoder names and their context windows', async () => {
	const models = await new CodexAgent(await fakeCodex()).models();

	expect(models).toEqual([
		{
			id: 'codex:gpt-6-sol',
			provider: 'codex',
			label: 'GPT-6-Sol',
			model: 'gpt-6-sol',
			baseUrl: null,
			apiKeyPreview: null,
			contextWindow: 272000,
			efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
			defaultEffort: 'medium'
		},
		expect.objectContaining({ id: 'codex:gpt-6-luna', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] })
	]);
});

test('a listed model runs at the picked effort it offers, else at its default; one not listed yet at Medium', async () => {
	const agent = new CodexAgent(await fakeCodex());

	expect(agent.modelSettings('gpt-6-sol', 'minimal')).toEqual({ reasoningEffort: 'medium' });

	await agent.models();

	expect(agent.modelSettings('gpt-6-sol', 'xhigh')).toEqual({ reasoningEffort: 'xhigh' });
	expect(agent.modelSettings('gpt-6-sol', 'minimal')).toEqual({ reasoningEffort: 'medium' });
	expect(agent.modelSettings('gpt-6-sol', undefined)).toEqual({ reasoningEffort: 'medium' });
});

test('detect reports the version and whether the CLI is signed in', async () => {
	const signedOut = await new CodexAgent(await fakeCodex()).detect();
	const signedIn = await new CodexAgent(await fakeCodex({ FAKE_CODEX_SIGNED_IN: '1' })).detect();

	expect(signedOut).toMatchObject({ installed: true, version: '0.167.0', signedIn: false, login: 'codex login' });
	expect(signedIn.signedIn).toBe(true);
});

describe('CodexAgent.complete', () => {
	test('saves no session, passes no MCP server, drops the server’s keys, and streams the answer and its usage', async () => {
		const env = await fakeCodex({ RECODER_SECRET_KEY: 'k', OPENAI_API_KEY: 'sk-x', CODEX_API_KEY: 'c' });
		const tokens: string[] = [];
		const reasoning: string[] = [];
		let usage: TokenUsage | undefined;

		const reply = await new CodexAgent(env).complete(
			call({ reasoningEffort: 'high', onUsage: (u) => (usage = u), onReasoning: (r) => reasoning.push(r) }),
			(t) => tokens.push(t)
		);

		const logged = await loggedCall(env.FAKE_CODEX_LOG);
		const childEnv = (await readFile(`${env.FAKE_CODEX_LOG}.env`, 'utf8')).split('\n');

		expect(reply).toBe('the reply');
		expect(tokens).toEqual(['the reply']);
		expect(reasoning).toEqual(['**Reading the diff**']);
		expect(usage).toMatchObject({ inputTokens: 1000, outputTokens: 20, cachedInputTokens: 600 });
		expect(logged.args.slice(0, 2)).toEqual(['exec', '--ephemeral']);
		expect(logged.args.some((arg) => arg.startsWith('mcp_servers.'))).toBe(false);
		expect(logged.args).toEqual(expect.arrayContaining(['--disable', 'shell_tool', 'model_reasoning_effort="high"']));
		expect(logged.system).toStartWith('Review the diff.');
		expect(logged.prompt).toBe('diff --git a/x b/x');
		expect(childEnv).toContain('CODEX_HOME');
		expect(childEnv).not.toContain('RECODER_SECRET_KEY');
		expect(childEnv).not.toContain('OPENAI_API_KEY');
		expect(childEnv).not.toContain('CODEX_API_KEY');
	});

	test('offers the model no sub-agents, though the CLI’s catalog gives it a version', async () => {
		const env = await fakeCodex();

		await new CodexAgent(env).complete(call({ model: 'gpt-6-luna' }));

		expect((await loggedCall(env.FAKE_CODEX_LOG)).subagents).toBeNull();
	});

	test('runs no call when the CLI prints no catalog to turn sub-agents off in', async () => {
		const env = await fakeCodex({ FAKE_CODEX_CATALOG: 'not a catalog' });

		const error = await new CodexAgent(env).complete(call()).catch((e: unknown) => e);

		expect(error).toMatchObject({ message: expect.stringContaining('sub-agents could not be turned off') });
		expect(existsSync(env.FAKE_CODEX_LOG ?? '')).toBe(false);
	});

	test.each([
		['auth', 401, /signed out\. Run: codex login/],
		['crash', 0, /boom/]
	] as const)('a %s call fails as an LlmError with status %d', async (mode, status, message) => {
		const error = await new CodexAgent(await fakeCodex({ FAKE_CODEX_MODE: mode }))
			.complete(call())
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(LlmError);
		expect(error).toMatchObject({ status, message: expect.stringMatching(message) });
	});

	test('a usage cap fails as a UsageLimitError that Recoder words as out of usage, with the reset time', async () => {
		const agent = new CodexAgent(await fakeCodex({ FAKE_CODEX_MODE: 'limit' }));

		const error = await agent.complete(call()).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(UsageLimitError);

		const failure = agent.describeFailure(error as UsageLimitError, 'fallback');

		expect(failure.usageLimit).toEqual({ provider: 'codex', name: 'Codex', usageUrl: null });
		expect(failure.reason).toContain('try again at 5:28 AM');
	});
});
