import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TokenUsage } from '@recoder/shared';
import { CursorAgent } from '../../../src/agents/cursor/cursor';
import { LlmError, UsageLimitError } from '../../../src/models/llm/errors';
import type { ChatOptions } from '../../../src/models/llm/types';
import { cursorCall, fakeCursor } from '../../helpers/fake-cursor';

function call(overrides: Partial<ChatOptions> = {}): ChatOptions {
	return {
		provider: 'cursor',
		baseUrl: '',
		apiKey: '',
		model: 'composer-2.5',
		messages: [
			{ role: 'system', content: 'Review the diff.' },
			{ role: 'user', content: 'diff --git a/x b/x' }
		],
		...overrides
	};
}

test('the models are the account’s list, with cursor: ids', async () => {
	const models = await new CursorAgent(await fakeCursor()).models();

	expect(models.map((m) => m.id)).toEqual([
		'cursor:auto',
		'cursor:claude-sonnet-4-5',
		'cursor:gpt-5',
		'cursor:composer-2.5'
	]);
});

test('a missing CLI is not installed and its calls say how to install it', async () => {
	const env = { PATH: '', HOME: await mkdtemp(join(tmpdir(), 'no-home-')) };
	const agent = new CursorAgent(env);

	expect(agent.installed()).toBe(false);
	await expect(agent.models()).rejects.toThrow(/not installed/);
	await expect(agent.complete(call())).rejects.toThrow(/not installed/);
});

describe('CursorAgent.complete', () => {
	test('streams the answer, counts the reported usage and runs under a config that denies every built-in tool', async () => {
		const env = await fakeCursor({
			RECODER_SECRET_KEY: 'k',
			OPENAI_API_KEY: 'k',
			CURSOR_CONFIG_DIR: '/user/config',
			CURSOR_API_KEY: 'cursor-key',
			FAKE_CURSOR_SIGNED_IN: '1'
		});

		const log = env.FAKE_CURSOR_LOG ?? '';
		let usage: TokenUsage | undefined;
		const tokens: string[] = [];
		const thinking: string[] = [];

		const reply = await new CursorAgent(env).complete(
			call({ onUsage: (u) => (usage = u), onReasoning: (t) => thinking.push(t) }),
			(t) => tokens.push(t)
		);

		const seen = await cursorCall(log);
		const childEnv = await readFile(`${log}.env`, 'utf8');

		const config = JSON.parse(seen.cliConfig ?? '{}') as {
			approvalMode?: string;
			permissions?: { allow?: string[]; deny?: string[] };
		};

		expect(reply).toBe('the reply');
		expect(tokens.join('')).toBe('the reply');
		expect(thinking.join('')).toBe('Hmm.');

		expect(usage).toMatchObject({
			inputTokens: 1000,
			outputTokens: 20,
			totalTokens: 1020,
			cachedInputTokens: 600
		});

		expect(config.approvalMode).toBe('allowlist');
		expect(config.permissions?.allow).toEqual([]);

		expect(config.permissions?.deny).toEqual(
			expect.arrayContaining(['Shell(*)', 'Shell(**)', 'Read(**)', 'Write(**)', 'WebFetch(*)'])
		);

		expect(seen.mcp).toBeNull();
		expect(seen.auth).toContain(join(env.HOME ?? '', '.config', 'cursor', 'auth.json'));
		expect(seen.configDir).toContain('recoder-cursor-');
		expect(seen.cwdFiles).toEqual([]);
		expect(seen.prompt).toContain('Review the diff.');
		expect(seen.prompt).toContain('diff --git a/x b/x');

		expect(seen.args).toEqual(
			expect.arrayContaining([
				'-p',
				'--output-format',
				'stream-json',
				'--stream-partial-output',
				'--trust',
				'--model',
				'composer-2.5'
			])
		);

		expect(seen.args).not.toContain('--force');
		expect(seen.args).not.toContain('--yolo');
		expect(childEnv).not.toContain('RECODER_SECRET_KEY');
		expect(childEnv).not.toContain('OPENAI_API_KEY');
		expect(childEnv).not.toContain('/user/config');
		expect(childEnv).toContain(`CURSOR_CONFIG_DIR=${seen.configDir}`);
		expect(childEnv).toContain('CURSOR_API_KEY=cursor-key');
	});

	test('a signed-out CLI fails as a sign-in error and a spent plan as a usage limit', async () => {
		const signedOut = await new CursorAgent(await fakeCursor({ FAKE_CURSOR_MODE: 'auth' }))
			.complete(call())
			.catch((e: unknown) => e);

		const limited = await new CursorAgent(await fakeCursor({ FAKE_CURSOR_MODE: 'limit' }))
			.complete(call())
			.catch((e: unknown) => e);

		expect(signedOut).toBeInstanceOf(LlmError);
		expect((signedOut as LlmError).status).toBe(401);
		expect((signedOut as LlmError).message).toContain('cursor-agent login');
		expect(limited).toBeInstanceOf(UsageLimitError);
		expect((limited as LlmError).status).toBe(429);
		expect((limited as LlmError).message).toMatch(/usage limit/);
	});

	test('output that is not stream-json fails with the last line quoted and its credential redacted', async () => {
		const error = await new CursorAgent(await fakeCursor({ FAKE_CURSOR_MODE: 'garbage' }))
			.complete(call())
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(LlmError);
		expect((error as LlmError).message).toContain('could not be parsed');
		expect((error as LlmError).message).not.toContain('fake-cursor-token-123');
	});

	test('a crashed CLI fails with what it printed on stderr', async () => {
		const error = await new CursorAgent(await fakeCursor({ FAKE_CURSOR_MODE: 'crash' }))
			.complete(call())
			.catch((e: unknown) => e);

		expect((error as LlmError).message).toContain('boom');
	});
});

test('detect reports the version and whether the CLI is signed in', async () => {
	const signedOut = await new CursorAgent(await fakeCursor()).detect();
	const signedIn = await new CursorAgent(await fakeCursor({ FAKE_CURSOR_SIGNED_IN: '1' })).detect();

	expect(signedOut).toMatchObject({ installed: true, version: '2026.11.11-b912975', signedIn: false });
	expect(signedIn.signedIn).toBe(true);
});
