import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import type { TokenUsage } from '@recoder/shared';
import { DevinAgent } from '../../../src/agents/devin/devin';
import { LlmError } from '../../../src/models/llm/errors';
import type { ChatOptions } from '../../../src/models/llm/types';
import { fakeDevin } from '../../helpers/fake-devin';

function call(overrides: Partial<ChatOptions> = {}): ChatOptions {
	return {
		provider: 'devin',
		baseUrl: '',
		apiKey: '',
		model: 'swe-2-high',
		messages: [
			{ role: 'system', content: 'Review the diff.' },
			{ role: 'user', content: 'diff --git a/x b/x' }
		],
		...overrides
	};
}

test('the models are the runnable lines of the list, with their context windows', async () => {
	const models = await new DevinAgent(await fakeDevin()).models();

	expect(models.map((m) => [m.id, m.contextWindow])).toEqual([
		['devin:swe-2-high', 262000],
		['devin:gpt-6-sol-medium', 1000000]
	]);
});

describe('DevinAgent.complete', () => {
	test('runs under a config that denies every tool, without the server keys, and counts the exported tokens', async () => {
		const env = await fakeDevin({ RECODER_SECRET_KEY: 'k', DEVIN_MODEL: 'other', FAKE_DEVIN_SIGNED_IN: '1' });
		const log = env.FAKE_DEVIN_LOG ?? '';
		let usage: TokenUsage | undefined;
		const tokens: string[] = [];

		const reply = await new DevinAgent(env).complete(call({ onUsage: (u) => (usage = u) }), (t) => tokens.push(t));

		const text = await readFile(log, 'utf8');
		const config = JSON.parse(text.split('config: ')[1]);
		const childEnv = await readFile(`${log}.env`, 'utf8');

		expect(reply).toBe('the reply\n');
		expect(tokens.join('')).toBe(reply);
		expect(config.permissions.deny).toEqual(['read', 'edit', 'grep', 'glob', 'exec', 'mcp__*']);
		expect(config.devin).toEqual({ org_id: 'org-1' });
		expect(text).toContain('Review the diff.');
		expect(text).toContain('diff --git a/x b/x');
		expect(text).toContain('--model] [swe-2-high]');
		expect(childEnv).not.toContain('RECODER_SECRET_KEY');
		expect(childEnv).not.toContain('DEVIN_MODEL');
		expect(usage).toMatchObject({ inputTokens: 1000, outputTokens: 20, totalTokens: 1020, cachedInputTokens: 600 });
	});

	test('deletes the session the call saved', async () => {
		const env = await fakeDevin();

		await new DevinAgent(env).complete(call());

		await Bun.sleep(300);
		expect(await readFile(`${env.FAKE_DEVIN_LOG}.rm`, 'utf8')).toBe('quiet-owl\n');
	});

	test('resumes the session when a refused tool left no text, and counts the usage once', async () => {
		const env = await fakeDevin({ FAKE_DEVIN_MODE: 'refused' });
		const usages: TokenUsage[] = [];

		const reply = await new DevinAgent(env).complete(call({ onUsage: (u) => usages.push(u) }));

		const text = await readFile(env.FAKE_DEVIN_LOG ?? '', 'utf8');

		expect(reply).toBe('the reply\n');
		expect(text).toContain('--resume] [quiet-owl]');
		expect(text).toContain('nothing can be run');
		expect(usages).toHaveLength(1);
	});

	test.each([
		['signedout', 401, /signed out/],
		['crash', 0, /boom/],
		['limited', 429, /free model rate limit.*00:01 UTC/],
		['empty', 0, /without a reply/]
	] as const)('a %s call fails as an LlmError with status %d', async (mode, status, message) => {
		const error = await new DevinAgent(await fakeDevin({ FAKE_DEVIN_MODE: mode }))
			.complete(call())
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(LlmError);
		expect((error as LlmError).status).toBe(status);
		expect((error as LlmError).message).toMatch(message);
	});
});

test('detect reports the version and whether the CLI is signed in', async () => {
	const signedOut = await new DevinAgent(await fakeDevin()).detect();
	const signedIn = await new DevinAgent(await fakeDevin({ FAKE_DEVIN_SIGNED_IN: '1' })).detect();

	expect(signedOut).toMatchObject({ installed: true, version: '3000.11.3', signedIn: false });
	expect(signedIn.signedIn).toBe(true);
});
