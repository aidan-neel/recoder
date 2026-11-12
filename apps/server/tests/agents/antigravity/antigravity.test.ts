import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TokenUsage } from '@recoder/shared';
import { AntigravityAgent } from '../../../src/agents/antigravity/antigravity';
import { LlmError, UsageLimitError } from '../../../src/models/llm/errors';
import { JSON_MODE_INSTRUCTION } from '../../../src/models/llm/request-fields';
import type { ChatOptions } from '../../../src/models/llm/types';
import { fakeAntigravity, fakeAntigravityCalls, savedConversationPaths } from '../../helpers/fake-antigravity';
import { allGone, spawnedPids } from '../../helpers/fake-claude';

function call(overrides: Partial<ChatOptions> = {}): ChatOptions {
	return {
		provider: 'antigravity',
		baseUrl: '',
		apiKey: '',
		model: 'gemini-4-carbon',
		reasoningEffort: 'high',
		messages: [
			{ role: 'system', content: 'Review the diff.' },
			{ role: 'user', content: 'diff --git a/x b/x' }
		],
		...overrides
	};
}

async function failure(agent: AntigravityAgent, opts = call()): Promise<LlmError> {
	const error = await agent.complete(opts).catch((caught: unknown) => caught);

	if (!(error instanceof LlmError)) throw new Error(`expected an LlmError, got ${String(error)}`);

	return error;
}

describe('AntigravityAgent.detect', () => {
	test('reports the version and whether the CLI is signed in', async () => {
		const signedOut = await new AntigravityAgent(await fakeAntigravity({ FAKE_ANTIGRAVITY_SIGNED_IN: '0' })).detect();
		const signedIn = await new AntigravityAgent(await fakeAntigravity()).detect();

		expect(signedOut).toMatchObject({ installed: true, version: '1.5.6', error: null, signedIn: false });
		expect(signedIn).toMatchObject({ installed: true, version: '1.5.6', error: null, signedIn: true });
	});

	test('a pinned empty binary means not installed without running anything', async () => {
		const env = await fakeAntigravity({ RECODER_ANTIGRAVITY_BIN: '' });
		const status = await new AntigravityAgent(env).detect();

		expect(status).toMatchObject({ installed: false, version: null, signedIn: null, path: null });
	});
});

describe('AntigravityAgent.models and modelSettings', () => {
	test('collapses multi-effort families into one entry and preserves single-variant slugs', async () => {
		const agent = new AntigravityAgent(await fakeAntigravity());
		const models = await agent.models();

		expect(
			models.map((entry) => ({
				id: entry.id,
				label: entry.label,
				contextWindow: entry.contextWindow,
				efforts: entry.efforts,
				defaultEffort: entry.defaultEffort
			}))
		).toEqual([
			{
				id: 'antigravity:gemini-4-carbon',
				label: 'Gemini 4 Carbon',
				contextWindow: 1_000_000,
				efforts: ['low', 'medium', 'high'],
				defaultEffort: 'medium'
			},
			{
				id: 'antigravity:gemini-3.8-flash',
				label: 'Gemini 3.8 Flash',
				contextWindow: 1_000_000,
				efforts: ['low', 'medium', 'high'],
				defaultEffort: 'high'
			},
			{
				id: 'antigravity:claude-sonnet-4-6',
				label: 'Claude Sonnet 4.6 (Thinking)',
				contextWindow: 200_000,
				efforts: undefined,
				defaultEffort: undefined
			},
			{
				id: 'antigravity:gpt-oss-120b-medium',
				label: 'GPT-OSS 120B (Medium)',
				contextWindow: 200_000,
				efforts: undefined,
				defaultEffort: undefined
			}
		]);

		expect(agent.modelSettings('gemini-4-carbon', 'xhigh')).toEqual({ reasoningEffort: 'medium' });
		expect(agent.modelSettings('gemini-4-carbon', 'low')).toEqual({ reasoningEffort: 'low' });
		expect(agent.modelSettings('gpt-oss-120b-medium', 'high')).toEqual({});
	});

	test('aborting models kills the CLI process group immediately', async () => {
		const env = await fakeAntigravity({ FAKE_ANTIGRAVITY_MODE: 'spawn' });
		const log = env.FAKE_ANTIGRAVITY_LOG ?? '';
		const controller = new AbortController();
		const pending = new AntigravityAgent(env).models(controller.signal).catch((caught: unknown) => caught);
		const pids = await spawnedPids(log);

		controller.abort();
		await pending;

		expect(await allGone(pids)).toBe(true);
	});

	test('listing models while signed out fails with a 401 naming the sign-in command', async () => {
		const agent = new AntigravityAgent(await fakeAntigravity({ FAKE_ANTIGRAVITY_SIGNED_IN: '0' }));
		const error = await agent.models().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(LlmError);

		if (error instanceof LlmError) {
			expect(error.status).toBe(401);
			expect(error.message).toContain('agy acp --login');
		}
	});
});

describe('AntigravityAgent.complete', () => {
	test('streams reasoning and text, reports token usage, and removes scratch and conversation files', async () => {
		const env = await fakeAntigravity();
		const tokens: string[] = [];
		const reasoning: string[] = [];
		let usage: TokenUsage | undefined;

		const reply = await new AntigravityAgent(env).complete(
			call({
				onUsage: (reported) => (usage = reported),
				onReasoning: (delta) => reasoning.push(delta)
			}),
			(delta) => tokens.push(delta)
		);

		const [logged] = await fakeAntigravityCalls(env.FAKE_ANTIGRAVITY_LOG ?? '');

		expect(reply).toBe('Hi there');
		expect(tokens).toEqual(['Hi ', 'there']);
		expect(reasoning).toEqual(['Hmm.']);

		expect(usage).toEqual({
			inputTokens: 350,
			outputTokens: 42,
			totalTokens: 392,
			cachedInputTokens: 50,
			cacheWriteInputTokens: null,
			reasoningOutputTokens: 4
		});

		expect(logged).toBeDefined();

		if (logged) {
			expect(existsSync(dirname(logged.cwd))).toBe(false);

			for (const target of savedConversationPaths(env.HOME ?? '', logged.conversationId)) {
				expect(existsSync(target)).toBe(false);
			}
		}
	});

	test('sends the prompt as stream-json on stdin in an antigravity-empty directory with all tools denied', async () => {
		const env = await fakeAntigravity();

		await new AntigravityAgent(env).complete(call({ jsonSchema: { name: 'review', schema: { type: 'object' } } }));

		const [logged] = await fakeAntigravityCalls(env.FAKE_ANTIGRAVITY_LOG ?? '');

		expect(logged).toBeDefined();
		if (!logged) return;

		expect(logged.prompt).toBe('diff --git a/x b/x');
		expect(logged.args).not.toContain('diff --git a/x b/x');
		expect(logged.args).toContain('--disable-slash-commands');
		expect(logged.args).toEqual(expect.arrayContaining(['--model', 'gemini-4-carbon', '--effort', 'high']));
		expect(logged.cwd).toMatch(/\/antigravity-empty$/);
		expect(logged.agentMd).toContain('Review the diff.\n\nYou have no tools.');
		expect(logged.agentMd).toContain(JSON_MODE_INSTRUCTION);
		expect(logged.agentMd).toContain('excludeDefaultComponents: true');
		expect(logged.agentMd).toContain('commandExecutionPolicy: "off"');
		expect(logged.agentMd).not.toContain('mcpServers:');

		expect(logged.settings).toMatchObject({
			toolPermission: 'request-review',
			allowNonWorkspaceAccess: false,
			permissions: {
				allow: [],
				deny: expect.arrayContaining(['command(*)', 'read_file(*)', 'write_file(*)', 'mcp(*)'])
			}
		});
	});

	test('strips server keys, tokens, secrets and Antigravity overrides from the child environment', async () => {
		const stripped = {
			RECODER_REVIEW_API_KEY: 'recoder-leak',
			AGY_TOKEN: 'agy-leak',
			ANTIGRAVITY_API_KEY: 'antigravity-leak',
			GEMINI_API_KEY: 'gemini-leak',
			GOOGLE_API_KEY: 'google-leak',
			OPENAI_API_KEY: 'openai-leak',
			ANTHROPIC_API_KEY: 'anthropic-leak',
			GH_TOKEN: 'gh-leak',
			GITHUB_TOKEN: 'github-leak',
			AWS_SECRET_ACCESS_KEY: 'aws-leak',
			DB_PASSWORD: 'pw-leak'
		};

		const kept = {
			USER: 'reviewer',
			SHELL: '/bin/sh',
			TERM: 'xterm',
			LANG: 'C.UTF-8',
			HTTPS_PROXY: 'http://proxy.test:3128'
		};

		const env = await fakeAntigravity({ ...stripped, ...kept });

		await new AntigravityAgent(env).complete(call());

		const [logged] = await fakeAntigravityCalls(env.FAKE_ANTIGRAVITY_LOG ?? '');

		expect(logged).toBeDefined();
		if (!logged) return;

		for (const key of Object.keys(stripped)) expect(logged.env).not.toHaveProperty(key);
		expect(JSON.stringify(logged.env)).not.toContain('-leak');
		expect(logged.env).toMatchObject(kept);
	});

	test('maps signed-out, quota, throttle, crash, empty, malformed and flooded exits to contract errors', async () => {
		const auth = await failure(new AntigravityAgent(await fakeAntigravity({ FAKE_ANTIGRAVITY_MODE: 'auth' })));
		const limit = await failure(new AntigravityAgent(await fakeAntigravity({ FAKE_ANTIGRAVITY_MODE: 'limit' })));
		const throttle = await failure(new AntigravityAgent(await fakeAntigravity({ FAKE_ANTIGRAVITY_MODE: 'throttle' })));
		const crash = await failure(new AntigravityAgent(await fakeAntigravity({ FAKE_ANTIGRAVITY_MODE: 'crash' })));
		const empty = await failure(new AntigravityAgent(await fakeAntigravity({ FAKE_ANTIGRAVITY_MODE: 'empty' })));
		const garbage = await failure(new AntigravityAgent(await fakeAntigravity({ FAKE_ANTIGRAVITY_MODE: 'garbage' })));
		const flood = await failure(new AntigravityAgent(await fakeAntigravity({ FAKE_ANTIGRAVITY_MODE: 'flood' })));

		expect(auth.status).toBe(401);
		expect(auth.message).toContain('agy acp --login');

		expect(limit).toBeInstanceOf(UsageLimitError);
		expect(limit.status).toBe(429);
		expect(limit.message).toContain('resets at 3pm UTC');

		expect(throttle).not.toBeInstanceOf(UsageLimitError);
		expect(throttle.status).toBe(429);

		expect(crash.message).toContain('boom');
		expect(empty.message).toContain('without a reply');

		expect(garbage.message).toContain('could not be parsed');
		expect(garbage.message).not.toContain('sk-antigravity-secret-token-9999');

		expect(flood.message).toContain('printed more than');
	});

	test('aborting or timing out kills the CLI process group and removes any conversation it started', async () => {
		const spawnEnv = await fakeAntigravity({ FAKE_ANTIGRAVITY_MODE: 'spawn' });
		const abortSignal = new AbortController();
		const runningCall = failure(new AntigravityAgent(spawnEnv), call({ signal: abortSignal.signal }));
		const groupPids = await spawnedPids(spawnEnv.FAKE_ANTIGRAVITY_LOG ?? '');

		abortSignal.abort();

		const cancelled = await runningCall;
		const groupStopped = await allGone(groupPids);

		expect(cancelled.message).toBe('Model request cancelled');
		expect(groupStopped).toBe(true);

		const [logged] = await fakeAntigravityCalls(spawnEnv.FAKE_ANTIGRAVITY_LOG ?? '');

		if (logged) {
			for (const target of savedConversationPaths(spawnEnv.HOME ?? '', logged.conversationId)) {
				expect(existsSync(target)).toBe(false);
			}
		}

		const timedOut = await failure(
			new AntigravityAgent(await fakeAntigravity({ FAKE_ANTIGRAVITY_MODE: 'spawn' })),
			call({ timeoutMs: 200 })
		);

		expect(timedOut.message).toBe('Model request timed out after 0s');
	});
});
