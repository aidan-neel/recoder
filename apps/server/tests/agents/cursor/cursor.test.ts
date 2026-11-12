import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TokenUsage } from '@recoder/shared';
import { CursorAgent } from '../../../src/agents/cursor/cursor';
import { signInState } from '../../../src/agents/cursor/cursor-output';
import { LlmError, UsageLimitError } from '../../../src/models/llm/errors';
import type { ChatOptions } from '../../../src/models/llm/types';
import { cursorCall, cursorStatusCalls, fakeCursor } from '../../helpers/fake-cursor';

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
			sandbox?: { readBoundary?: string };
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
		expect(config.sandbox?.readBoundary).toBe('workspace');
		expect(config.permissions?.allow).toEqual([]);

		expect(config.permissions?.deny).toEqual(
			expect.arrayContaining(['Shell(*)', 'Shell(**)', 'Read(**)', 'Write(**)', 'WebFetch(*)'])
		);

		expect(seen.mcp).toBeNull();
		expect(seen.auth).toBe('none');
		expect(seen.configDir).toContain('recoder-cursor-');
		expect(seen.dataDir).toContain('recoder-cursor-');
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

	test('a failed result quotes its text, so a credential in it never reaches the error', async () => {
		const error = await new CursorAgent(
			await fakeCursor({
				FAKE_CURSOR_MODE: 'result-error',
				FAKE_CURSOR_ERROR_TEXT: 'MCP server recoder1 unreachable: Authorization: Bearer fake-result-token-456'
			})
		)
			.complete(call())
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(LlmError);
		expect((error as LlmError).message).not.toContain('fake-result-token-456');
		expect((error as LlmError).message).toContain('[redacted]');
	});

	test('a failed result about permissions is a plain error, not a usage limit', async () => {
		const error = await new CursorAgent(
			await fakeCursor({
				FAKE_CURSOR_MODE: 'result-error',
				FAKE_CURSOR_ERROR_TEXT: 'Error: insufficient permissions to read the file'
			})
		)
			.complete(call())
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(LlmError);
		expect(error).not.toBeInstanceOf(UsageLimitError);
		expect((error as LlmError).status).toBe(0);
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

test('a CLI whose status is plain signed-out text still reads as signed out', async () => {
	const env = await fakeCursor({ FAKE_CURSOR_STATUS_TEXT: 'Not logged in' });
	const status = await new CursorAgent(env).detect();

	expect(status.signedIn).toBe(false);
});

test('the sign-in check runs under the same isolated dirs a call gets', async () => {
	const env = await fakeCursor({ FAKE_CURSOR_SIGNED_IN: '1' });
	const log = env.FAKE_CURSOR_LOG ?? '';

	await new CursorAgent(env).detect();

	const calls = await cursorStatusCalls(log);

	expect(calls.length).toBeGreaterThan(0);

	for (const call of calls) {
		expect(call.configDir).toContain('recoder-cursor-status-');
		expect(call.dataDir).toContain('recoder-cursor-status-');
		expect(call.cwd).toContain('recoder-cursor-status-');
		expect(call.configDir).not.toContain(env.HOME ?? '\u0000');
	}
});

test('signInState reads signed-out phrases before the signed-in words they contain', () => {
	expect(signInState(1, 'Not logged in')).toBe(false);
	expect(signInState(1, 'You are not authenticated')).toBe(false);
	expect(signInState(1, 'Unauthenticated')).toBe(false);
	expect(signInState(0, 'Logged in as dev@example.com')).toBe(true);
});
