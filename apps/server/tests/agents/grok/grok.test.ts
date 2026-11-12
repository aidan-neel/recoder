import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import type { TokenUsage } from '@recoder/shared';
import { GrokAgent } from '../../../src/agents/grok/grok';
import { LlmError, UsageLimitError } from '../../../src/models/llm/errors';
import type { ChatOptions } from '../../../src/models/llm/types';
import { fakeGrok, fakeGrokCalls, fakeGrokEnv } from '../../helpers/fake-grok';

function call(overrides: Partial<ChatOptions> = {}): ChatOptions {
	return {
		provider: 'grok',
		baseUrl: '',
		apiKey: '',
		model: 'grok-4.7',
		messages: [
			{ role: 'system', content: 'Review the diff.' },
			{ role: 'user', content: 'diff --git a/x b/x' }
		],
		...overrides
	};
}

/** The `LlmError` a `complete()` call on the fake's `mode` rejects with. */
async function completeError(mode: string): Promise<LlmError> {
	const error = await new GrokAgent(await fakeGrok({ FAKE_GROK_MODE: mode })).complete(call()).catch((e: unknown) => e);

	if (!(error instanceof LlmError)) throw new Error(`expected an LlmError, got ${String(error)}`);

	return error;
}

test('the models are the runnable rows of `grok models`, under the grok: prefix', async () => {
	const models = await new GrokAgent(await fakeGrok()).models();

	expect(models.map((m) => m.id)).toEqual([
		'grok:grok-4.7',
		'grok:grok-4.7-build-fast',
		'grok:grok-4.6',
		'grok:grok-4.5'
	]);

	expect(models[0]).toMatchObject({ provider: 'grok', model: 'grok-4.7', label: 'grok-4.7' });
});

describe('GrokAgent.complete', () => {
	test('runs in an empty home without the user config or the server keys, and counts the result tokens', async () => {
		const env = await fakeGrok({
			RECODER_SECRET_KEY: 'k',
			GROK_MEMORY: '1',
			OPENAI_API_KEY: 'sk-test',
			FAKE_GROK_SIGNED_IN: '1'
		});

		const log = env.FAKE_GROK_LOG ?? '';
		let usage: TokenUsage | undefined;
		const tokens: string[] = [];

		const reply = await new GrokAgent(env).complete(call({ onUsage: (u) => (usage = u) }), (t) => tokens.push(t));

		const [run] = await fakeGrokCalls(log);

		if (!run) throw new Error('the fake logged no call');

		const childEnv = await fakeGrokEnv(log);
		const answer = JSON.parse(reply);

		expect(answer).toMatchObject({ done: true });
		expect(tokens.join('')).toBe(reply);

		expect(run.args).toEqual(
			expect.arrayContaining([
				'--prompt-file',
				'--model',
				'grok-4.7',
				'--tools',
				'search_tool,use_tool',
				'--output-format',
				'streaming-messages-json',
				'--no-subagents',
				'--no-plan',
				'--disable-web-search',
				'bypassPermissions',
				'--max-turns',
				'4'
			])
		);

		expect(run.args.some((arg) => arg === '-s')).toBe(true);
		expect(run.system).toContain('Review the diff.');
		expect(run.prompt).toBe('diff --git a/x b/x');
		expect(run.prompt).not.toContain('Review the diff.');
		expect(run.homeConfig).toContain('official_marketplace_auto_installed = false');
		expect(run.homeConfig).not.toContain('evil');
		expect(run.authLink).toBe(`${env.HOME}/.grok/auth.json`);
		expect(run.grok.HOME).not.toBe(env.HOME);
		expect(run.grok.GROK_HOME).toBe(`${run.grok.HOME}/.grok`);
		expect(run.grok.GROK_MEMORY).toBe('0');
		expect(run.grok.GROK_CLAUDE_SKILLS_ENABLED).toBe('false');
		expect(childEnv).not.toContain('RECODER_SECRET_KEY');
		expect(childEnv).not.toContain('OPENAI_API_KEY');
		expect(childEnv).not.toContain('GROK_MEMORY=1');
		expect(usage).toMatchObject({ inputTokens: 350, outputTokens: 42, cachedInputTokens: 50 });
	});

	test('deletes the home the call ran under, sessions and all', async () => {
		const env = await fakeGrok();

		await new GrokAgent(env).complete(call());

		const [run] = await fakeGrokCalls(env.FAKE_GROK_LOG ?? '');

		if (!run) throw new Error('the fake logged no call');

		expect(run.grok.HOME).toBeTruthy();
		expect(existsSync(run.grok.HOME ?? '')).toBe(false);
	});

	test('reports the auth source the init line names', async () => {
		const env = await fakeGrok();
		const sources: string[] = [];

		await new GrokAgent(env).complete(call({ onApiKeySource: (source) => sources.push(source) }));

		expect(sources).toEqual(['oauth']);
	});

	test('a failed call maps the CLI failure to the right LlmError status and message', async () => {
		for (const [mode, status, message] of [
			['auth', 401, /grok login/],
			['limit', 429, /usage limit/],
			['crash', 0, /boom/],
			['empty', 0, /could not be parsed/]
		] as const) {
			const error = await new GrokAgent(await fakeGrok({ FAKE_GROK_MODE: mode }))
				.complete(call())
				.catch((e: unknown) => e);

			expect(error).toBeInstanceOf(LlmError);
			expect(error).toMatchObject({ status, message: expect.stringMatching(message) });
		}
	});

	test('a usage cap fails as a UsageLimitError', async () => {
		const error = await new GrokAgent(await fakeGrok({ FAKE_GROK_MODE: 'limit' }))
			.complete(call())
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(UsageLimitError);
	});

	test('a throttle fails as a retryable 429 that is not a usage limit', async () => {
		const error = await completeError('throttle');

		expect(error).not.toBeInstanceOf(UsageLimitError);
		expect(error).toMatchObject({ status: 429 });
	});

	test('a run that fails before its result line maps signed-out stderr to a 401', async () => {
		const error = await completeError('stderr-auth');

		expect(error).toMatchObject({ status: 401, message: expect.stringMatching(/grok login/) });
	});

	test('a run that fails before its result line never quotes a credential from stderr', async () => {
		const error = await completeError('stderr-token');

		expect(error.message).toContain('[redacted]');
		expect(error.message).not.toContain('fake-grok-token-12345');
	});

	test('malformed output fails without echoing what it printed', async () => {
		const error = await completeError('garbage');

		expect(error.message).toMatch(/could not be parsed/);
		expect(error.message).not.toContain('fake-grok-token-12345');
	});
});

test('detect reports the version and whether the CLI is signed in', async () => {
	const signedOut = await new GrokAgent(await fakeGrok({ FAKE_GROK_SIGNED_IN: '0' })).detect();
	const signedIn = await new GrokAgent(await fakeGrok({ FAKE_GROK_SIGNED_IN: '1' })).detect();
	const unknown = await new GrokAgent(await fakeGrok({ FAKE_GROK_SIGNED_IN: 'error' })).detect();

	expect(signedOut).toMatchObject({ installed: true, version: '1.0.77', signedIn: false });
	expect(signedIn.signedIn).toBe(true);
	expect(unknown.signedIn).toBe(null);
});
