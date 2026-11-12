import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import type { AgentEvent, AgentRun } from '../../../src/agents/contract';
import { DevinAgent } from '../../../src/agents/devin/devin';
import { fakeDevin } from '../../helpers/fake-devin';
import { fixtureReview, testPromptStops } from '../../helpers/native-agent';

const PROMPT = { tools: true, timeoutMs: 10_000 };

/** A run on the fake CLI in `mode`, with its events collected and the path of the fake's log. */
async function openRun(mode = 'reply'): Promise<{ run: AgentRun; events: AgentEvent[]; log: string }> {
	const env = await fakeDevin({ FAKE_DEVIN_MODE: mode });
	const events: AgentEvent[] = [];

	const run = await new DevinAgent(env).openRun({
		model: 'swe-2-high',
		system: 'Review the diff.',
		tools: ['read_diff'],
		runTool: async () => ({ text: 'ok', isError: false }),
		onEvent: (event) => events.push(event),
		signal: new AbortController().signal
	});

	return { run, events, log: env.FAKE_DEVIN_LOG ?? '' };
}

/** The part of the fake's log after `label: `, up to the next labelled line. */
function logged(text: string, label: string): string {
	return text.split(`\n${label}: `)[1]?.split(/\n(?:mcp|config): /)[0] ?? '';
}

describe('DevinAgent.openRun', () => {
	test('denies the CLI its own tools and gives it only Recoder’s MCP server, in the local config of its directory', async () => {
		const { run, log } = await openRun();

		await run.prompt('Review it.', PROMPT);

		const text = await readFile(log, 'utf8');

		await run.close();

		const config = JSON.parse(logged(text, 'config')) as { permissions: { allow: string[]; deny: string[] } };

		const servers = JSON.parse(logged(text, 'mcp')) as {
			mcpServers: Record<string, { url: string; transport: string }>;
		};

		const [name] = Object.keys(servers.mcpServers);

		expect(config.permissions).toEqual({ allow: [`mcp__${name}__*`], deny: ['read', 'edit', 'grep', 'glob', 'exec'] });

		expect(servers.mcpServers[name]).toMatchObject({
			transport: 'http',
			url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:/)
		});

		expect(text).toContain('[-p] [--permission-mode] [auto]');
		expect(text).toContain('[--model] [swe-2-high]');
	});

	test('the answer streams as text within one step, which ends with the prompt’s usage', async () => {
		const { run, events } = await openRun();

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		expect(reply.text).toBe('the reply\n');

		expect(events).toEqual([
			{ type: 'step-start' },
			{ type: 'text', delta: 'the reply\n', partId: 'devin_1' },
			{
				type: 'usage',
				usage: {
					inputTokens: 1000,
					outputTokens: 20,
					totalTokens: 1020,
					cachedInputTokens: 600,
					cacheWriteInputTokens: null,
					reasoningOutputTokens: null
				}
			}
		]);
	});

	test('a later prompt resumes the session without the system prompt and counts only its own usage', async () => {
		const { run, events, log } = await openRun();

		await run.prompt('Review it.', PROMPT);
		await run.prompt('Continue.', PROMPT);

		const text = await readFile(log, 'utf8');

		await run.close();

		const usage = events.flatMap((event) => (event.type === 'usage' ? [event.usage.inputTokens] : []));

		expect(text).toContain('[--resume] [quiet-owl]');
		expect(logged(text, 'prompt')).toBe('Continue.');
		expect(usage).toEqual([1000, 500]);
	});

	test.each([
		['signedout', 401, /signed out/],
		['limited', 429, /free model rate limit/],
		['crash', 0, /boom/]
	] as const)('a %s prompt fails with status %d', async (mode, status, message) => {
		const { run } = await openRun(mode);

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		expect(reply.error?.status).toBe(status);
		expect(reply.error?.message).toMatch(message);
	});

	testPromptStops(() => openRun('spawn'));

	test('closing the run deletes the session the CLI saved', async () => {
		const { run, log } = await openRun();

		await run.prompt('Review it.', PROMPT);
		await run.close();
		await Bun.sleep(300);

		expect(await readFile(`${log}.rm`, 'utf8')).toBe('quiet-owl\n');
	});
});

test('a review agent on a Devin model completes through the shared engine, reading evidence through the gate', async () => {
	const { error, read } = await fixtureReview(
		new DevinAgent(await fakeDevin({ FAKE_DEVIN_MODE: 'tool' })),
		'swe-2-high'
	);

	expect(error).toBeUndefined();
	expect(read).toMatchObject({ isError: false, text: expect.stringContaining('+new') });
});
