import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { CodexAgent } from '../../../src/agents/codex/codex';
import type { AgentEvent, AgentRun } from '../../../src/agents/contract';
import { UsageLimitError } from '../../../src/models/llm/errors';
import { FAKE_CODEX_CREDENTIAL, FAKE_CODEX_SESSION, fakeCodex } from '../../helpers/fake-codex';
import { fixtureReview, openCollectingRun, testPromptStops } from '../../helpers/native-agent';

const PROMPT = { tools: true, timeoutMs: 10_000 };

/** One call the fake logged. */
const callSchema = z.object({
	args: z.array(z.string()),
	cwd: z.string(),
	files: z.array(z.string()),
	prompt: z.string(),
	system: z.string(),
	userConfig: z.string().nullable(),
	subagents: z.string().nullable()
});

type Call = z.infer<typeof callSchema>;

/** A run on the fake CLI in `mode`, with its events collected and the path of the fake's log. */
async function openRun(
	mode = 'reply',
	tools = ['read_diff']
): Promise<{ run: AgentRun; events: AgentEvent[]; log: string }> {
	const env = await fakeCodex({ FAKE_CODEX_MODE: mode });

	const { run, events } = await openCollectingRun(new CodexAgent(env), {
		model: 'gpt-6-sol',
		reasoningEffort: 'high',
		system: 'Review the diff.',
		tools
	});

	return { run, events, log: env.FAKE_CODEX_LOG ?? '' };
}

/** The calls the fake logged, in order. */
async function calls(log: string): Promise<Call[]> {
	const lines = (await readFile(log, 'utf8')).trim().split('\n');

	return lines.map((line) => callSchema.parse(JSON.parse(line)));
}

/** The `-c` overrides of one call, by key. */
function overrides(call: Call): Record<string, string> {
	const pairs = call.args.flatMap((arg, i) => (call.args[i - 1] === '-c' ? [arg.split(/=(.*)/s).slice(0, 2)] : []));

	return Object.fromEntries(pairs);
}

/** The features one call turned off. */
function disabled(call: Call): string[] {
	return call.args.flatMap((arg, i) => (call.args[i - 1] === '--disable' ? [arg] : []));
}

describe('CodexAgent.openRun', () => {
	test('turns the CLI’s own tools off, gives it only Recoder’s MCP server, and runs it in an empty directory', async () => {
		const { run, log } = await openRun();

		await run.prompt('Review it.', PROMPT);

		const [call] = await calls(log);
		const config = overrides(call);

		await run.close();

		expect(call.args.slice(0, 2)).toEqual(['exec', '--json']);
		expect(disabled(call)).toEqual(expect.arrayContaining(['shell_tool', 'unified_exec', 'view_image', 'multi_agent']));
		expect(config).toMatchObject({ sandbox_mode: '"read-only"', approval_policy: '"never"', web_search: '"disabled"' });

		const servers = Object.keys(config).filter((key) => key.startsWith('mcp_servers.'));

		expect(servers).toEqual([
			expect.stringMatching(/^mcp_servers\.recoder\d+\.url$/),
			expect.stringMatching(/^mcp_servers\.recoder\d+\.default_tools_approval_mode$/),
			expect.stringMatching(/^mcp_servers\.recoder\d+\.tool_timeout_sec$/)
		]);

		expect(config[servers[0]]).toMatch(/^"http:\/\/127\.0\.0\.1:\d+\/mcp\//);
		expect(call.files).toEqual([]);
		expect(call.args.slice(-4)).toEqual(['gpt-6-sol', '-c', 'model_reasoning_effort="high"', '-']);
	});

	test('a run without tools passes no MCP server', async () => {
		const { run, log } = await openRun('reply', []);

		await run.prompt('Review it.', PROMPT);

		const [call] = await calls(log);

		await run.close();

		expect(call.args.some((arg) => arg.startsWith('mcp_servers.'))).toBe(false);
	});

	test('loads none of the user’s config, rules, hooks, plugins or project instructions, and gets Recoder’s system prompt', async () => {
		const { run, log } = await openRun();

		await run.prompt('Review it.', PROMPT);

		const [call] = await calls(log);

		await run.close();

		expect(call.userConfig).toBeNull();
		expect(call.args).toEqual(expect.arrayContaining(['--ignore-user-config', '--ignore-rules', '--strict-config']));
		expect(disabled(call)).toEqual(expect.arrayContaining(['hooks', 'plugins', 'apps', 'memories']));
		expect(overrides(call)).toMatchObject({ project_doc_max_bytes: '0', 'history.persistence': '"none"' });
		expect(call.system).toBe('Review the diff.');
	});

	test('no prompt, first or resumed, offers the model sub-agents, though the CLI’s catalog gives it a version', async () => {
		const { run, log } = await openRun();

		await run.prompt('Review it.', PROMPT);
		await run.prompt('Continue.', PROMPT);

		const logged = await calls(log);

		await run.close();

		expect(logged.map((call) => call.subagents)).toEqual([null, null]);
	});

	test('a prompt is one step: reasoning and the answer stream, and the turn ends it with its usage', async () => {
		const { run, events } = await openRun();

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		expect(reply.text).toBe('the reply');
		expect(reply.error).toBeUndefined();

		expect(events).toEqual([
			{ type: 'step-start' },
			{ type: 'reasoning', delta: '**Reading the diff**', partId: 'codex_1_item_0' },
			{ type: 'text', delta: 'the reply', partId: 'codex_1_item_1' },
			{
				type: 'usage',
				usage: {
					inputTokens: 1000,
					outputTokens: 20,
					totalTokens: 1020,
					cachedInputTokens: 600,
					cacheWriteInputTokens: 0,
					reasoningOutputTokens: 5
				}
			}
		]);
	});

	test('a later prompt resumes the session and counts only its own usage', async () => {
		const { run, events, log } = await openRun();

		await run.prompt('Review it.', PROMPT);
		await run.prompt('Continue.', { ...PROMPT, schema: { type: 'object' } });

		const [, second] = await calls(log);

		await run.close();

		const usage = events.flatMap((event) => (event.type === 'usage' ? [event.usage.inputTokens] : []));

		expect(second.args.slice(0, 2)).toEqual(['exec', 'resume']);
		expect(second.args.slice(-2)).toEqual([FAKE_CODEX_SESSION, '-']);
		expect(second.prompt).toStartWith('Continue.\n\n');
		expect(usage).toEqual([1000, 500]);
	});

	test('a signed-out prompt fails with a 401 naming the sign-in command', async () => {
		const { run } = await openRun('auth');

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		expect(reply.error?.status).toBe(401);
		expect(reply.error?.message).toBe('Codex is signed out. Run: codex login');
	});

	test('a usage cap is a UsageLimitError that keeps the CLI’s reset time', async () => {
		const { run } = await openRun('limit');

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		expect(reply.error).toBeInstanceOf(UsageLimitError);
		expect(reply.error?.message).toContain('try again at 5:28 AM');
	});

	test.each([
		['garbage', /request failed/],
		['crash', /boom/]
	] as const)('a %s prompt fails, and its error quotes no credential', async (mode, message) => {
		const { run, events } = await openRun(mode);

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		expect(reply.error?.message).toMatch(message);
		expect(JSON.stringify([reply, events])).not.toContain(FAKE_CODEX_CREDENTIAL);
	});

	test('a CLI that prints past the output cap is stopped', async () => {
		const { run } = await openRun('flood');

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		expect(reply.error?.message).toMatch(/printed more than/);
	});

	testPromptStops(() => openRun('spawn'));

	test.each(['reply', 'auth'])('closing the run after a %s prompt deletes its session and its files', async (mode) => {
		const { run, log } = await openRun(mode);

		await run.prompt('Review it.', PROMPT);

		const [call] = await calls(log);

		await run.close();

		expect(await readFile(`${log}.rm`, 'utf8')).toBe(`${FAKE_CODEX_SESSION}\n`);
		expect(existsSync(dirname(call.cwd))).toBe(false);
	});
});

test('a review agent on a Codex model completes through the shared engine, reading evidence through the gate', async () => {
	const { error, read } = await fixtureReview(
		new CodexAgent(await fakeCodex({ FAKE_CODEX_MODE: 'tool' })),
		'gpt-6-sol'
	);

	expect(error).toBeUndefined();
	expect(read).toMatchObject({ isError: false, text: expect.stringContaining('+new') });
});
