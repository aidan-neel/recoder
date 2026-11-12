import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import type { AgentEvent, AgentRun } from '../../../src/agents/contract';
import { CopilotAgent } from '../../../src/agents/copilot/copilot';
import { COPILOT_FAILURES, fakeCopilot } from '../../helpers/fake-copilot';
import { fixtureReview, testOutputCapPrompt, testPromptFailures, testPromptStops } from '../../helpers/native-agent';

const PROMPT = { tools: true, timeoutMs: 10_000 };

/** What the fake logged for one call: its argv, prompt, working directory, `COPILOT_HOME` and the settings there. */
const callSchema = z.object({
	args: z.array(z.string()),
	prompt: z.string(),
	cwd: z.string(),
	home: z.string(),
	settings: z.string()
});

/** The MCP config a call was given, and the allow rule beside it. */
const mcpConfigSchema = z.object({ mcpServers: z.record(z.string(), z.object({ url: z.string(), type: z.string() })) });

/** A run on the fake CLI in `mode`, with its events collected and what its fake logged. */
async function openRun(
	mode = 'reply',
	tools: readonly string[] = ['read_diff']
): Promise<{ run: AgentRun; events: AgentEvent[]; log: string; calls: () => Promise<z.infer<typeof callSchema>[]> }> {
	const env = await fakeCopilot({ FAKE_COPILOT_MODE: mode });
	const log = env.FAKE_COPILOT_LOG ?? '';
	const events: AgentEvent[] = [];

	const run = await new CopilotAgent(env).openRun({
		model: 'gpt-5.6-sol',
		reasoningEffort: 'high',
		system: 'Review the diff.',
		tools,
		signal: new AbortController().signal,
		runTool: async () => ({ text: 'ok', isError: false }),
		onEvent: (event) => events.push(event)
	});

	return {
		run,
		events,
		log,
		calls: async () =>
			(await readFile(log, 'utf8'))
				.trim()
				.split('\n')
				.map((line) => callSchema.parse(JSON.parse(line)))
	};
}

/** The value that follows `flag` in a call's arguments. */
function after(args: string[], flag: string): string | undefined {
	return args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
}

describe('CopilotAgent.openRun', () => {
	test('denies the CLI its own tools, gives it only Recoder’s MCP server, and runs in its own empty directory', async () => {
		const { run, calls } = await openRun();

		await run.prompt('Review it.', PROMPT);

		const [call] = await calls();
		const config = mcpConfigSchema.parse(JSON.parse(after(call.args, '--additional-mcp-config') ?? '{}'));
		const [server] = Object.keys(config.mcpServers);

		await run.close();

		expect(after(call.args, '--deny-tool')).toBe('shell,write,read,url,memory');
		expect(after(call.args, '--excluded-tools')).toContain('bash');
		expect(after(call.args, '--excluded-tools')).toContain('skill');
		expect(call.args).toContain('--disable-builtin-mcps');
		expect(call.args).toContain('--no-custom-instructions');
		expect(call.args).toContain('--no-ask-user');
		expect(call.args).toContain('--disallow-temp-dir');
		expect(call.args).toContain('--sync-session=off');
		expect(after(call.args, '--available-tools')).toBe(server);
		expect(after(call.args, '--allow-tool')).toBe(server);

		expect(config.mcpServers[server]).toMatchObject({
			type: 'http',
			url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:/)
		});

		expect(call.cwd.startsWith(tmpdir())).toBe(true);
		expect(call.cwd.split('/').at(-1)).toBe('work');
		expect(after(call.args, '--model')).toBe('gpt-5.6-sol');
		expect(after(call.args, '--reasoning-effort')).toBe('high');
		expect(after(call.args, '--session-id')).toBeString();
	});

	test('a run without tools gives the model no tool at all: an unmatched --available-tools and no MCP config', async () => {
		const { run, calls } = await openRun('reply', []);

		await run.prompt('Answer.', PROMPT);

		const [call] = await calls();

		await run.close();

		expect(call.args).not.toContain('--additional-mcp-config');
		expect(call.args).not.toContain('--allow-tool');
		expect(after(call.args, '--available-tools')).toBe('recoder-no-tools');
	});

	test('a final prompt with tools off is given no MCP server, so the model cannot call one', async () => {
		const { run, calls } = await openRun();

		await run.prompt('Review it.', PROMPT);
		await run.prompt('Answer.', { tools: false, timeoutMs: 10_000 });

		const [, final] = await calls();

		await run.close();

		expect(final.args).not.toContain('--additional-mcp-config');
		expect(final.args).not.toContain('--allow-tool');
		expect(after(final.args, '--available-tools')).toBe('recoder-no-tools');
	});

	test('runs under an empty COPILOT_HOME, so the user’s hooks and MCP servers are not in it', async () => {
		const { run, calls } = await openRun();

		await run.prompt('Review it.', PROMPT);

		const [call] = await calls();

		await run.close();

		expect(call.home).toBeTruthy();
		expect(call.home).not.toContain('/.copilot');
		expect(call.settings).toBe('missing');
	});

	test('the answer streams as text and reasoning within one step, which ends with the prompt’s usage', async () => {
		const { run, events } = await openRun('reply');

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		expect(reply.text).toBe('the reply');

		expect(events).toEqual([
			{ type: 'step-start' },
			{ type: 'reasoning', delta: 'Hmm.', partId: 'r1' },
			{ type: 'text', delta: 'the ', partId: 'm1' },
			{ type: 'text', delta: 'reply', partId: 'm1' },
			{
				type: 'usage',
				usage: {
					inputTokens: 1000,
					outputTokens: 20,
					totalTokens: 1020,
					cachedInputTokens: 600,
					cacheWriteInputTokens: 5,
					reasoningOutputTokens: null
				}
			}
		]);
	});

	test('a later prompt resumes the same session without the system prompt, and counts only its own usage', async () => {
		const { run, calls, events } = await openRun();

		await run.prompt('Review it.', PROMPT);
		await run.prompt('Continue.', PROMPT);

		const [first, second] = await calls();
		const session = after(first.args, '--session-id');

		await run.close();

		const usage = events.flatMap((event) => (event.type === 'usage' ? [event.usage.inputTokens] : []));

		expect(session).toBeString();
		expect(after(second.args, '--session-id')).toBe(session);
		expect(second.prompt).toBe('Continue.');
		expect(usage).toEqual([1000, 500]);
	});

	test('each model call is a step that ends before the next starts, and the last ends with the prompt’s usage', async () => {
		const { run, events } = await openRun('tool');

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		const steps = events.flatMap((event): (string | number | null)[] => {
			if (event.type === 'step-start') return ['start'];
			if (event.type === 'usage') return [event.usage.inputTokens];

			return [];
		});

		expect(reply.error).toBeUndefined();
		expect(steps).toEqual(['start', null, 'start', 1000]);
	});

	test('a prompt that fails ends no step, and carries what it used on the reply', async () => {
		const { run, events } = await openRun('limit');

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		expect(events.filter((event) => event.type === 'step-start')).toHaveLength(1);
		expect(events.filter((event) => event.type === 'usage')).toEqual([]);
		expect(reply.tokens?.inputTokens).toBe(1000);
	});

	testPromptFailures(openRun, COPILOT_FAILURES);

	test('output that is not JSONL fails the prompt, and the error does not carry the fake credential', async () => {
		const { run, events } = await openRun('garbage');

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		const quoted = JSON.stringify(events).concat(reply.error?.message ?? '');

		expect(reply.error).toBeInstanceOf(Error);
		expect(quoted).not.toContain('fake-copilot-credential');
		expect(quoted).toContain('Welcome to GitHub Copilot CLI!');
	});

	testOutputCapPrompt(openRun);

	testPromptStops(() => openRun('spawn'));

	test('closing the run deletes the session the CLI saved and its scratch config', async () => {
		const { run, calls } = await openRun();

		await run.prompt('Review it.', PROMPT);

		const [call] = await calls();
		const session = `${call.home}/session-state/${after(call.args, '--session-id')}`;
		const before = existsSync(session);

		await run.close();

		expect(before).toBe(true);
		expect(existsSync(session)).toBe(false);
		expect(existsSync(call.home)).toBe(false);
	});

	test('closing a run whose prompt failed still deletes the session the CLI saved', async () => {
		const { run, calls } = await openRun('crash');

		await run.prompt('Review it.', PROMPT);

		const [call] = await calls();

		await run.close();

		expect(existsSync(call.home)).toBe(false);
	});
});

test('a review agent on a Copilot model completes through the shared engine, reading evidence through the gate', async () => {
	const { error, read } = await fixtureReview(
		new CopilotAgent(await fakeCopilot({ FAKE_COPILOT_MODE: 'tool' })),
		'gpt-5.6-sol'
	);

	expect(error).toBeUndefined();
	expect(read).toMatchObject({ isError: false, text: expect.stringContaining('+new') });
});

test('a prompt may make more tool calls than one step allows, one model call at a time', async () => {
	const { error, read } = await fixtureReview(
		new CopilotAgent(await fakeCopilot({ FAKE_COPILOT_MODE: 'tools' })),
		'gpt-5.6-sol'
	);

	expect(error).toBeUndefined();
	expect(read).toMatchObject({ isError: false, text: expect.stringContaining('+new') });
});
