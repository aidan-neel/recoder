import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import type { AgentEvent, AgentRun, AgentRunOptions } from '../../../src/agents/contract';
import { GrokAgent } from '../../../src/agents/grok/grok';
import { fakeGrok, fakeGrokCalls, fakeGrokEnv } from '../../helpers/fake-grok';
import { fixtureReview, testOutputCapPrompt, testPromptFailures, testPromptStops } from '../../helpers/native-agent';

const PROMPT = { tools: true, timeoutMs: 10_000 };

/** A run on the fake CLI in `mode`, with its events collected, the fake's log, and the env it ran with. */
async function openRun(
	mode = 'answer',
	settings: Record<string, string> = {},
	tools: readonly string[] = ['read_diff']
): Promise<{ run: AgentRun; events: AgentEvent[]; log: string; env: Record<string, string> }> {
	const env = await fakeGrok({ FAKE_GROK_MODE: mode, ...settings });
	const events: AgentEvent[] = [];

	const options: AgentRunOptions = {
		model: 'grok-4.7',
		system: 'Review the diff.',
		tools,
		runTool: async () => ({ text: 'ok', isError: false }),
		onEvent: (event) => events.push(event),
		signal: new AbortController().signal
	};

	const run = await new GrokAgent(env).openRun(options);

	return { run, events, log: env.FAKE_GROK_LOG ?? '', env };
}

/** The first call the fake logged; every test that reads one fails loudly when there is none. */
async function firstCall(log: string) {
	const [call] = await fakeGrokCalls(log);

	if (!call) throw new Error('the fake logged no call');

	return call;
}

describe('GrokAgent.openRun', () => {
	test('turns off every built-in tool and gives the CLI only Recoder’s MCP server, in the project config of its directory', async () => {
		const { run, log } = await openRun();

		await run.prompt('Review it.', PROMPT);
		await run.close();

		const call = await firstCall(log);

		expect(call.args).toEqual(
			expect.arrayContaining([
				'--prompt-file',
				'--model',
				'grok-4.7',
				'--system-prompt-override',
				'--output-format',
				'streaming-messages-json',
				'--include-partial-messages',
				'--tools',
				'search_tool,use_tool',
				'--no-subagents',
				'--no-plan',
				'--disable-web-search',
				'bypassPermissions',
				'--trust'
			])
		);

		expect(call.args.some((arg) => arg === '-s')).toBe(true);
		expect(call.system).toBe('Review the diff.');

		expect(call.projectConfig).toMatch(
			/^\[mcp_servers\.recoder\d+\]\nurl = "http:\/\/127\.0\.0\.1:\d+\/mcp\/[^"]+"\n?$/
		);

		expect(call.projectConfig).not.toContain('evil');
	});

	test('keeps the user config, hooks, plugins, rules, memory and compat surfaces out of the call', async () => {
		const { run, log, env } = await openRun();

		await run.prompt('Review it.', PROMPT);
		await run.close();

		const call = await firstCall(log);

		expect(call.grok.HOME).not.toBe(env.HOME);
		expect(call.grok.GROK_HOME).toBe(`${call.grok.HOME}/.grok`);
		expect(call.grok.GROK_AUTH_PATH).toBe(`${env.HOME}/.grok/auth.json`);
		expect(call.grok.GROK_MEMORY).toBe('0');
		expect(call.grok.GROK_CLAUDE_HOOKS_ENABLED).toBe('false');
		expect(call.grok.GROK_CLAUDE_MCPS_ENABLED).toBe('false');
		expect(call.grok.GROK_CLAUDE_SKILLS_ENABLED).toBe('false');
		expect(call.grok.GROK_CURSOR_MCPS_ENABLED).toBe('false');
		expect(call.homeConfig).toContain('official_marketplace_auto_installed = false');
		expect(call.homeConfig).toContain('ignore = [');
		expect(call.homeConfig).not.toContain('evil');
		expect(call.homeConfig).not.toContain('SessionStart');
	});

	test('strips the server keys and every user override from the environment, keeping only Grok’s own auth', async () => {
		const { run, log } = await openRun('answer', {
			RECODER_SECRET_KEY: 'k',
			GROK_USER_FLAG: '1',
			OPENAI_API_KEY: 'sk-test',
			GH_TOKEN: 'ghp_test',
			XAI_API_KEY: 'xai-test-key'
		});

		await run.prompt('Review it.', PROMPT);
		await run.close();

		const childEnv = await fakeGrokEnv(log);

		expect(childEnv).not.toContain('RECODER_SECRET_KEY');
		expect(childEnv).not.toContain('GROK_USER_FLAG');
		expect(childEnv).not.toContain('OPENAI_API_KEY');
		expect(childEnv).not.toContain('GH_TOKEN');
		expect(childEnv).toContain('XAI_API_KEY=xai-test-key');
	});

	test('a run without tools configures no MCP server at all', async () => {
		const { run, log } = await openRun('answer', {}, []);

		await run.prompt('Review it.', PROMPT);
		await run.close();

		const call = await firstCall(log);

		expect(call.projectConfig).toBe('');
	});

	test('streams each model message as a step with its reasoning, text and usage', async () => {
		const { run, events } = await openRun();

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		const answer = JSON.parse(reply.text);

		expect(answer).toMatchObject({ done: true });
		expect(events.filter((event) => event.type === 'step-start')).toHaveLength(2);
		expect(events).toContainEqual({ type: 'reasoning', delta: 'Hmm.', partId: 'msg_1_0' });
		expect(events).toContainEqual({ type: 'text', delta: reply.text, partId: 'msg_2_0' });

		expect(events.filter((event) => event.type === 'usage').map((event) => event.usage)).toEqual([
			{
				inputTokens: 150,
				outputTokens: 12,
				totalTokens: 162,
				cachedInputTokens: 50,
				cacheWriteInputTokens: 0,
				reasoningOutputTokens: null
			},
			{
				inputTokens: 200,
				outputTokens: 30,
				totalTokens: 230,
				cachedInputTokens: 0,
				cacheWriteInputTokens: 0,
				reasoningOutputTokens: null
			}
		]);

		expect(reply.tokens).toMatchObject({ inputTokens: 350, outputTokens: 42, totalTokens: 392, cachedInputTokens: 50 });
	});

	test('a later prompt resumes the session the first started', async () => {
		const { run, log } = await openRun();

		await run.prompt('Review it.', PROMPT);
		await run.prompt('Continue.', PROMPT);
		await run.close();

		const calls = await fakeGrokCalls(log);
		const [first, second] = calls;

		if (!first || !second) throw new Error('the fake logged fewer than two calls');

		const created = first.args[first.args.indexOf('-s') + 1];

		expect(first.args).toContain('-s');
		expect(second.args).toEqual(expect.arrayContaining(['-r', created ?? '']));
		expect(second.prompt).toBe('Continue.');
		expect(second.system).toBe('Review the diff.');
	});

	testPromptFailures(openRun, [
		{ mode: 'auth', status: 401, message: /grok login/ },
		{ mode: 'limit', status: 429, message: /usage limit/, usageLimit: true },
		{ mode: 'crash', status: 0, message: /boom/ }
	]);

	test('a prompt that fails before its result line never quotes a credential from stderr', async () => {
		const { run } = await openRun('stderr-token');

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		expect(reply.error?.message).toContain('[redacted]');
		expect(reply.error?.message).not.toContain('fake-grok-token-12345');
	});

	test('a prompt that fails before its result line maps signed-out stderr to a 401', async () => {
		const { run } = await openRun('stderr-auth');

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		expect(reply.error).toMatchObject({ status: 401, message: expect.stringMatching(/grok login/) });
	});

	test('malformed output reports the bad line without echoing what it printed', async () => {
		const { run, events } = await openRun('garbage');

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		expect(reply.error?.message).toMatch(/could not be parsed/);
		expect(reply.error?.message).not.toContain('fake-grok-token-12345');
		expect(events.some((event) => event.type === 'error' && event.message.includes('not JSON'))).toBe(true);
	});

	testOutputCapPrompt(openRun);

	testPromptStops(() => openRun('spawn'));

	test('closing the run deletes its home, sessions and working directory, on success and on failure', async () => {
		for (const mode of ['answer', 'crash'] as const) {
			const { run, log } = await openRun(mode);

			await run.prompt('Review it.', PROMPT);
			await run.close();

			const call = await firstCall(log);
			const home = call.grok.HOME ?? '';

			expect(home).toContain('recoder-grok-run-');
			expect(existsSync(home)).toBe(false);
		}
	});
});

test('a review agent on a Grok model completes through the shared engine, reading evidence through the gate', async () => {
	const { error, read } = await fixtureReview(new GrokAgent(await fakeGrok({ FAKE_GROK_MODE: 'answer' })), 'grok-4.7');

	expect(error).toBeUndefined();
	expect(read).toMatchObject({ isError: false, text: expect.stringContaining('+new') });
});
