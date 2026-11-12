import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeAgent } from '../../../src/agents/claude-code/claude-code';
import type { AgentEvent, AgentRun } from '../../../src/agents/contract';
import { fakeClaudeAgent, fakeClaudeCalls } from '../../helpers/fake-claude-agent';
import { fakeClaudeLog } from '../../helpers/fake-claude';
import { fixtureReview, testPromptStops } from '../../helpers/native-agent';

const PROMPT = { tools: true, timeoutMs: 10_000 };

/** A run on the fake CLI in `mode`, logging to a fresh file, with its events collected. */
async function openRun(
	mode = 'answer',
	settings: { tools?: string[]; signal?: AbortSignal } = {}
): Promise<{ run: AgentRun; events: AgentEvent[]; log: string; config: string }> {
	const log = await fakeClaudeLog();
	const config = await mkdtemp(join(tmpdir(), 'fake-claude-config-'));
	const env = await fakeClaudeAgent({ FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_LOG: log, CLAUDE_CONFIG_DIR: config });
	const events: AgentEvent[] = [];

	const run = await new ClaudeCodeAgent(env).openRun({
		model: 'claude-opus-5-5',
		reasoningEffort: 'high',
		system: 'Review.',
		tools: settings.tools ?? ['read_diff'],
		runTool: async (name) => ({ text: `read ${name}`, isError: false }),
		onEvent: (event) => events.push(event),
		signal: settings.signal ?? new AbortController().signal
	});

	return { run, events, log, config };
}

/** The value that follows `flag` in a call's arguments. */
function after(args: string[], flag: string): string | undefined {
	return args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
}

describe('ClaudeCodeAgent.openRun', () => {
	test('gives the CLI only Recoder’s MCP server, with its own tools, settings and hooks off', async () => {
		const { run, log } = await openRun();

		await run.prompt('Review it.', PROMPT);
		await run.close();

		const [{ args }] = await fakeClaudeCalls(log);
		const config = JSON.parse(after(args, '--mcp-config') ?? '{}') as { mcpServers: Record<string, { url: string }> };
		const [server] = Object.keys(config.mcpServers);

		expect(after(args, '--tools')).toBe('');
		expect(after(args, '--setting-sources')).toBe('');
		expect(after(args, '--settings')).toBe('{"disableAllHooks":true}');
		expect(after(args, '--allowedTools')).toBe(`mcp__${server}`);
		expect(after(args, '--permission-mode')).toBe('dontAsk');
		expect(args).toContain('--strict-mcp-config');
		expect(args).not.toContain('--safe-mode');
		expect(config.mcpServers[server].url).toStartWith('http://127.0.0.1:');
	});

	test('a run without tools passes no MCP server', async () => {
		const { run, log } = await openRun('answer', { tools: [] });

		await run.prompt('Answer.', PROMPT);
		await run.close();

		const [{ args }] = await fakeClaudeCalls(log);

		expect(args).not.toContain('--mcp-config');
		expect(args).not.toContain('--allowedTools');
	});

	test('each model message is a step with its own usage, and thinking and text stream as they arrive', async () => {
		const { run, events } = await openRun();

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		const steps = events.filter((event) => event.type !== 'activity' && !event.type.startsWith('tool'));

		expect(reply.error).toBeUndefined();
		expect(JSON.parse(reply.text)).toEqual({ done: true, results: [{ isError: false, text: 'read read_diff' }] });

		expect(steps).toEqual([
			{ type: 'step-start', step: 'msg_1' },
			{ type: 'reasoning', delta: 'Hmm.', partId: 'msg_1_0' },
			{
				type: 'usage',
				step: 'msg_1',
				usage: {
					inputTokens: 150,
					outputTokens: 12,
					totalTokens: 162,
					cachedInputTokens: 50,
					cacheWriteInputTokens: null,
					reasoningOutputTokens: null
				}
			},
			{ type: 'step-start', step: 'msg_2' },
			{ type: 'text', delta: reply.text, partId: 'msg_2_0' },
			expect.objectContaining({ type: 'usage', step: 'msg_2' })
		]);
	});

	test('a later prompt resumes the session the first one started', async () => {
		const { run, log } = await openRun();

		await run.prompt('Review it.', PROMPT);
		await run.prompt('Continue.', PROMPT);
		await run.close();

		const [first, second] = await fakeClaudeCalls(log);
		const session = after(first.args, '--session-id');

		expect(session).toBeString();
		expect(after(second.args, '--resume')).toBe(session);
		expect(second.prompt).toBe('Continue.');
	});

	test('a prompt with a schema asks for JSON in words', async () => {
		const { run, log } = await openRun();

		await run.prompt('Review it.', { ...PROMPT, schema: { type: 'object' } });
		await run.close();

		const [{ prompt }] = await fakeClaudeCalls(log);

		expect(prompt).toStartWith('Review it.\n\n');
		expect(prompt.length).toBeGreaterThan('Review it.\n\n'.length);
	});

	test('a signed-out CLI fails the prompt as a sign-in error and a spent plan as a usage limit', async () => {
		const signedOut = await openRun('auth');
		const limited = await openRun('limit');

		const auth = await signedOut.run.prompt('Review it.', PROMPT);
		const limit = await limited.run.prompt('Review it.', PROMPT);

		await Promise.all([signedOut.run.close(), limited.run.close()]);

		expect(auth.error?.status).toBe(401);
		expect(auth.error?.message).toContain('claude auth login');
		expect(limit.error?.status).toBe(429);
		expect(limit.error?.message).toContain('resets 3pm');
	});

	test('output that is not stream-json is reported and fails the prompt with the line quoted', async () => {
		const { run, events } = await openRun('garbage');

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		expect(events).toContainEqual(expect.objectContaining({ type: 'error' }));
		expect(reply.error?.message).toContain('Welcome to Claude Code!');
	});

	testPromptStops(() => openRun('spawn'));

	test('closing the run deletes the session the CLI saved', async () => {
		const { run, log, config } = await openRun();

		await run.prompt('Review it.', PROMPT);

		const [{ args, cwd }] = await fakeClaudeCalls(log);
		const saved = join(config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${after(args, '--session-id')}.jsonl`);
		const before = existsSync(saved);

		await run.close();

		expect(before).toBe(true);
		expect(existsSync(saved)).toBe(false);
	});
});

test('a review agent on a Claude Code model completes through the shared engine, reading evidence through the gate', async () => {
	const { error, read } = await fixtureReview(
		new ClaudeCodeAgent(await fakeClaudeAgent({ FAKE_CLAUDE_LOG: await fakeClaudeLog() })),
		'claude-opus-5-5'
	);

	expect(error).toBeUndefined();
	expect(read).toMatchObject({ isError: false, text: expect.stringContaining('+new') });
});
