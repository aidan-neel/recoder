import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { CursorAgent } from '../../../src/agents/cursor/cursor';
import type { AgentEvent, AgentPromptOptions, AgentReply, AgentRun } from '../../../src/agents/contract';
import { UsageLimitError } from '../../../src/models/llm/errors';
import { cursorCalls, fakeCursor, type CursorCall } from '../../helpers/fake-cursor';
import { fixtureReview, testPromptStops } from '../../helpers/native-agent';

const PROMPT = { tools: true, timeoutMs: 10_000 };

/** The `cli-config.json` the CLI ran under, as the fake logged it. */
const cliConfigSchema = z.object({
	approvalMode: z.string().optional(),
	sandbox: z.object({ readBoundary: z.string() }),
	permissions: z.object({ allow: z.array(z.string()), deny: z.array(z.string()) })
});

/** The `mcp.json` of the run's data dir, as the fake logged it. */
const mcpSchema = z.object({ mcpServers: z.record(z.string(), z.object({ url: z.string() })) });

type FakeEnv = Record<string, string | undefined>;

/** A run on the fake CLI in `mode`, with its events collected, its env and its log path. */
async function openRun(
	mode = 'answer',
	settings: { tools?: string[]; signal?: AbortSignal } = {}
): Promise<{ run: AgentRun; events: AgentEvent[]; log: string; env: FakeEnv }> {
	const env = await fakeCursor({ FAKE_CURSOR_MODE: mode });
	const events: AgentEvent[] = [];

	const run = await new CursorAgent(env).openRun({
		model: 'composer-2.5',
		system: 'Review the diff.',
		tools: settings.tools ?? ['read_diff'],
		signal: settings.signal ?? new AbortController().signal,
		onEvent: (event) => events.push(event),
		runTool: async (name) => ({ text: `read ${name}`, isError: false })
	});

	return { run, events, log: env.FAKE_CURSOR_LOG ?? '', env };
}

/** Sends `text` to the run with `options`, closes it, and returns the reply and the calls the fake logged. */
async function exchange(
	opened: { run: AgentRun; log: string },
	text = 'Review it.',
	options: AgentPromptOptions = PROMPT
): Promise<{ reply: AgentReply; calls: CursorCall[] }> {
	const reply = await opened.run.prompt(text, options);

	await opened.run.close();

	return { reply, calls: await cursorCalls(opened.log) };
}

/** The value that follows `flag` in a call's arguments. */
function after(args: string[], flag: string): string | undefined {
	return args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
}

describe('CursorAgent.openRun', () => {
	test('gives the CLI only Recoder’s MCP server and denies its own tools, under an isolated config', async () => {
		const opened = await openRun();
		const { calls } = await exchange(opened);
		const [call] = calls;
		const config = cliConfigSchema.parse(JSON.parse(call.cliConfig ?? '{}'));
		const servers = mcpSchema.parse(JSON.parse(call.mcp ?? '{}'));
		const [name] = Object.keys(servers.mcpServers);

		expect(call.args).toEqual(
			expect.arrayContaining([
				'-p',
				'--output-format',
				'stream-json',
				'--trust',
				'--approve-mcps',
				'--model',
				'composer-2.5'
			])
		);

		expect(call.args).not.toContain('--force');
		expect(call.args).not.toContain('--yolo');
		expect(config.approvalMode).toBe('allowlist');
		expect(config.sandbox.readBoundary).toBe('workspace');
		expect(config.permissions.allow).toEqual([`Mcp(${name}:*)`]);

		expect(config.permissions.deny).toEqual(
			expect.arrayContaining(['Shell(*)', 'Shell(**)', 'Read(**)', 'Write(**)', 'WebFetch(*)'])
		);

		expect(servers.mcpServers[name].url).toMatch(/^http:\/\/127\.0\.0\.1:/);
		expect(call.configDir).toContain('recoder-cursor-run-');
		expect(call.configDir).not.toContain(opened.env.HOME ?? '\u0000');
		expect(call.dataDir).toContain('recoder-cursor-run-');
		expect(call.dataDir).not.toContain(opened.env.HOME ?? '\u0000');
		expect(call.cwdFiles).toEqual([]);
		expect(call.auth).toBe('none');
		expect(call.prompt).toContain('Review the diff.');
	});

	test('the user’s own Cursor config, hooks and MCP servers never reach the run', async () => {
		const opened = await openRun();
		const { calls } = await exchange(opened);
		const [call] = calls;
		const config = call.cliConfig ?? '';
		const servers = call.mcp ?? '';

		expect(config).not.toContain('sessionStart');
		expect(config).not.toContain('my-server');
		expect(servers).not.toContain('my-server');
		expect(Object.keys(mcpSchema.parse(JSON.parse(servers)).mcpServers)).toHaveLength(1);
	});

	test('a run without tools passes no MCP server', async () => {
		const opened = await openRun('answer', { tools: [] });
		const { calls } = await exchange(opened, 'Answer.');
		const [call] = calls;
		const config = cliConfigSchema.parse(JSON.parse(call.cliConfig ?? '{}'));

		expect(call.mcp).toBeNull();
		expect(config.permissions.allow).toEqual([]);
	});

	test('the answer streams as text and reasoning within one step, which ends with the prompt’s usage', async () => {
		const opened = await openRun();
		const { reply } = await exchange(opened);
		const seen = opened.events.filter((event) => event.type !== 'activity');

		expect(reply.error).toBeUndefined();
		expect(reply.text).toBe('the reply');

		expect(seen).toEqual([
			{ type: 'step-start' },
			{ type: 'reasoning', delta: 'Hmm.', partId: 'cursor_1' },
			{ type: 'text', delta: 'the r', partId: 'cursor_1' },
			{ type: 'text', delta: 'eply', partId: 'cursor_1' },
			{
				type: 'usage',
				usage: {
					inputTokens: 1000,
					outputTokens: 20,
					totalTokens: 1020,
					cachedInputTokens: 600,
					cacheWriteInputTokens: 0,
					reasoningOutputTokens: null
				}
			}
		]);
	});

	test('a later prompt resumes the chat the first one saved, without the system prompt, and counts only its own usage', async () => {
		const { run, events, log } = await openRun();

		await run.prompt('Review it.', PROMPT);
		await run.prompt('Continue.', PROMPT);
		await run.close();

		const [first, second] = await cursorCalls(log);
		const usage = events.flatMap((event) => (event.type === 'usage' ? [event.usage.inputTokens] : []));

		expect(after(second.args, '--resume')).toBeString();
		expect(after(first.args, '--resume')).toBeUndefined();
		expect(second.prompt).toBe('Continue.');
		expect(first.prompt).toContain('Review the diff.');
		expect(usage).toEqual([1000, 500]);
	});

	test('a prompt with a schema asks for JSON in words', async () => {
		const opened = await openRun();
		const { calls } = await exchange(opened, 'Review it.', { ...PROMPT, schema: { type: 'object' } });
		const [call] = calls;

		expect(call.prompt).toContain('Return a single valid JSON object');
	});

	test('a signed-out CLI fails the prompt as a sign-in error and a spent plan as a usage limit', async () => {
		const signedOut = await openRun('auth');
		const limited = await openRun('limit');

		const [auth, limit] = await Promise.all([
			signedOut.run.prompt('Review it.', PROMPT),
			limited.run.prompt('Review it.', PROMPT)
		]);

		await signedOut.run.close();
		await limited.run.close();

		expect(auth.error?.status).toBe(401);
		expect(auth.error?.message).toContain('cursor-agent login');
		expect(limit.error).toBeInstanceOf(UsageLimitError);
		expect(limit.error?.status).toBe(429);
		expect(limit.error?.message).toMatch(/usage limit/);
	});

	test('output that is not stream-json is reported and fails the prompt with the line quoted', async () => {
		const opened = await openRun('garbage');
		const { reply } = await exchange(opened);

		expect(opened.events).toContainEqual(expect.objectContaining({ type: 'error' }));
		expect(reply.error?.message).toContain('could not be parsed');
		expect(reply.error?.message).not.toContain('fake-cursor-token-123');
	});

	test('output past the cap stops the CLI and fails the prompt', async () => {
		const opened = await openRun('flood');
		const { reply } = await exchange(opened);

		expect(reply.error?.message).toContain('printed more than');
	});

	testPromptStops(() => openRun('spawn'));

	test('closing the run deletes its scratch dir, chats and config included', async () => {
		const { run, log } = await openRun();

		await run.prompt('Review it.', PROMPT);

		const [call] = await cursorCalls(log);
		const root = dirname(call.configDir);
		const before = existsSync(root);

		await run.close();

		expect(before).toBe(true);
		expect(existsSync(root)).toBe(false);
	});

	test('closing a run whose prompt failed still deletes its scratch dir', async () => {
		const opened = await openRun('auth');

		await opened.run.prompt('Review it.', PROMPT);

		const [call] = await cursorCalls(opened.log);
		const root = dirname(call.configDir);

		await opened.run.close();

		expect(existsSync(root)).toBe(false);
	});
});

test('a review agent on a Cursor model completes through the shared engine, reading evidence through the gate', async () => {
	const { error, read } = await fixtureReview(
		new CursorAgent(await fakeCursor({ FAKE_CURSOR_MODE: 'tool' })),
		'composer-2.5'
	);

	expect(error).toBeUndefined();
	expect(read).toMatchObject({ isError: false, text: expect.stringContaining('+new') });
});
