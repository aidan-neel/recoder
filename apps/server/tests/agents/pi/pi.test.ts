import { describe, expect, test } from 'bun:test';
import type { TokenUsage } from '@recoder/shared';
import { PiAgent } from '../../../src/agents/pi/pi';
import { LlmError, UsageLimitError } from '../../../src/models/llm/errors';
import type { ChatOptions } from '../../../src/models/llm/types';
import { fakePi, fakePiCalls } from '../../helpers/fake-pi';
import { testCallFailures } from '../../helpers/native-agent';

function call(overrides: Partial<ChatOptions> = {}): ChatOptions {
	return {
		provider: 'pi',
		baseUrl: '',
		apiKey: '',
		model: 'anthropic/claude-sonnet-4-5',
		messages: [
			{ role: 'system', content: 'Review the diff.' },
			{ role: 'user', content: 'diff --git a/x b/x' }
		],
		...overrides
	};
}

test('the models are the rows Pi lists, with their context windows and, for a thinking model, its levels', async () => {
	const models = await new PiAgent(await fakePi()).models();

	expect(models.map((m) => [m.id, m.model, m.contextWindow, m.efforts?.length ?? 0])).toEqual([
		['pi:anthropic/claude-sonnet-4-5', 'anthropic/claude-sonnet-4-5', 200_000, 5],
		['pi:local/m2', 'local/m2', 128_000, 0]
	]);
});

test('a Pi that lists no models fails the listing and reads as signed out', async () => {
	const agent = new PiAgent(await fakePi({ FAKE_PI_MODE: 'auth' }));

	const error = await agent.models().catch((e: unknown) => e);

	expect((error as LlmError).message).toContain('/login');
	expect(await agent.detect()).toMatchObject({ installed: true, version: '0.73.1', signedIn: false });
});

test('detect reports the version and a signed-in Pi', async () => {
	expect(await new PiAgent(await fakePi()).detect()).toMatchObject({ version: '0.73.1', signedIn: true });
});

describe('PiAgent.complete', () => {
	test('runs with every tool off, the prompt on stdin, and reports the reply, its thinking and its usage', async () => {
		const env = await fakePi({ RECODER_SECRET_KEY: 'k' });
		const tokens: string[] = [];
		const thinking: string[] = [];
		let usage: TokenUsage | undefined;

		const reply = await new PiAgent(env).complete(
			call({ reasoningEffort: 'low', onUsage: (u) => (usage = u), onReasoning: (t) => thinking.push(t) }),
			(t) => tokens.push(t)
		);

		const [logged] = await fakePiCalls(env);

		expect(reply).toBe('{"done":true,"results":[]}');
		expect(tokens.join('')).toBe(`${reply}\n`);
		expect(thinking).toEqual(['Hmm.']);
		expect(usage).toMatchObject({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 40 });
		expect(logged.args).toContain('--no-tools');
		expect(logged.args).not.toContain('--extension');
		expect(logged.args[logged.args.indexOf('--thinking') + 1]).toBe('low');
		expect(logged.system).toStartWith('Review the diff.');
		expect(logged.stdin).toBe('diff --git a/x b/x');
		expect(logged.env.RECODER_SECRET_KEY).toBeUndefined();
	});

	test('a call with thinking turned off asks Pi for none', async () => {
		const env = await fakePi();

		await new PiAgent(env).complete(call({ thinking: false, reasoningEffort: 'high' }));

		const [logged] = await fakePiCalls(env);

		expect(logged.args[logged.args.indexOf('--thinking') + 1]).toBe('off');
	});

	testCallFailures(
		async (mode) => new PiAgent(await fakePi({ FAKE_PI_MODE: mode })).complete(call()),
		[
			{ mode: 'auth', status: 401, message: /pi, then type \/login/, error: LlmError },
			{ mode: 'limit', status: 429, message: /exceeded your current quota/, error: UsageLimitError },
			{ mode: 'crash', status: 0, message: /boom/, error: LlmError }
		]
	);
});
