import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TokenUsage } from '@recoder/shared';
import { ClaudeCodeAgent } from '../../../src/agents/claude-code/claude-code';
import { LlmError } from '../../../src/models/llm/errors';
import { JSON_MODE_INSTRUCTION } from '../../../src/models/llm/request-fields';
import type { ChatOptions } from '../../../src/models/llm/types';
import { fakeClaude } from '../../helpers/fake-claude';

function call(overrides: Partial<ChatOptions> = {}): ChatOptions {
	return {
		provider: 'claude-code',
		baseUrl: '',
		apiKey: '',
		model: 'claude-opus-5-5',
		reasoningEffort: 'high',
		messages: [
			{ role: 'system', content: 'Review the diff.' },
			{ role: 'user', content: 'diff --git a/x b/x' }
		],
		...overrides
	};
}

async function failure(agent: ClaudeCodeAgent, opts = call()): Promise<LlmError> {
	const error = await agent.complete(opts).catch((e: unknown) => e);

	if (!(error instanceof LlmError)) throw new Error(`expected an LlmError, got ${String(error)}`);

	return error;
}

describe('ClaudeCodeAgent.detect', () => {
	test('reports the version and the sign-in state from auth status', async () => {
		const signedOut = await new ClaudeCodeAgent(await fakeClaude()).detect();
		const signedIn = await new ClaudeCodeAgent(await fakeClaude({ FAKE_CLAUDE_SIGNED_IN: '1' })).detect();

		expect(signedOut).toMatchObject({ installed: true, version: '2.1.281', error: null, signedIn: false });
		expect(signedIn.signedIn).toBe(true);
	});

	test('a pinned empty binary means not installed, without running anything', async () => {
		const status = await new ClaudeCodeAgent({ ...(await fakeClaude()), RECODER_CLAUDE_BIN: '' }).detect();

		expect(status).toMatchObject({ installed: false, version: null, signedIn: null, path: null });
	});
});

describe('ClaudeCodeAgent.complete', () => {
	test('streams text, sends the rest of the final result and reports usage from it', async () => {
		const tokens: string[] = [];
		const reasoning: string[] = [];
		let usage: TokenUsage | undefined;

		const text = await new ClaudeCodeAgent(await fakeClaude()).complete(
			call({ onUsage: (u) => (usage = u), onReasoning: (r) => reasoning.push(r) }),
			(t) => tokens.push(t)
		);

		expect(text).toBe('Hi there');
		expect(tokens).toEqual(['Hi ', 'there']);
		expect(reasoning).toEqual(['Hmm.']);

		expect(usage).toEqual({
			inputTokens: 130,
			outputTokens: 7,
			totalTokens: 137,
			cachedInputTokens: 100,
			cacheWriteInputTokens: 20,
			reasoningOutputTokens: 3
		});
	});

	test('sends the prompt on stdin and the system prompt as a file, from an empty directory with tools off', async () => {
		const log = join(await mkdtemp(join(tmpdir(), 'fake-claude-log-')), 'call.txt');
		const agent = new ClaudeCodeAgent(await fakeClaude({ FAKE_CLAUDE_LOG: log }));

		await agent.complete(call({ jsonSchema: { name: 'review', schema: { type: 'object' } } }));

		const written = await readFile(log, 'utf8');

		expect(written).toContain('prompt: diff --git a/x b/x');
		expect(written).toContain(`system: Review the diff.\n\n${JSON_MODE_INSTRUCTION}`);
		expect(written).toContain('[--tools] []');
		expect(written).toContain('[--permission-mode] [dontAsk]');
		expect(written).toContain('[--no-session-persistence]');
		expect(written).toContain('[--model] [claude-opus-5-5] [--effort] [high]');
		expect(written).not.toContain('diff --git a/x b/x]');
		expect(written).toMatch(/cwd: .*claude-code-empty\n/);
	});

	test('a signed-out CLI fails with a 401 that names the login command', async () => {
		const error = await failure(new ClaudeCodeAgent(await fakeClaude({ FAKE_CLAUDE_MODE: 'auth' })));

		expect(error.status).toBe(401);
		expect(error.message).toContain('claude auth login');
	});

	test('a usage limit fails with a 429 that keeps the reset time', async () => {
		const error = await failure(new ClaudeCodeAgent(await fakeClaude({ FAKE_CLAUDE_MODE: 'limit' })));

		expect(error.status).toBe(429);
		expect(error.message).toContain('resets 3pm (UTC)');
	});

	test('a CLI that exits without a result reports its last stderr line', async () => {
		const error = await failure(new ClaudeCodeAgent(await fakeClaude({ FAKE_CLAUDE_MODE: 'crash' })));

		expect(error.message).toBe("Claude Code failed: error: unknown option '--bogus'");
	});

	test('an aborted call kills the process and reports a cancellation', async () => {
		const controller = new AbortController();
		const agent = new ClaudeCodeAgent(await fakeClaude({ FAKE_CLAUDE_MODE: 'hang' }));
		const started = Date.now();

		setTimeout(() => controller.abort(), 100);

		const error = await failure(agent, call({ signal: controller.signal }));

		expect(error.message).toBe('Model request cancelled');
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	test('a call past its budget is killed and reports the timeout', async () => {
		const agent = new ClaudeCodeAgent(await fakeClaude({ FAKE_CLAUDE_MODE: 'hang' }));
		const error = await failure(agent, call({ timeoutMs: 200 }));

		expect(error.message).toBe('Model request timed out after 0s');
	});
});
