import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { AgentEvent, AgentRun } from '../../../src/agents/contract';
import { DevinAgent } from '../../../src/agents/devin/devin';
import { fakeDevin } from '../../helpers/fake-devin';
import { fixtureReview, openCollectingRun, testPromptFailures, testPromptStops } from '../../helpers/native-agent';

const PROMPT = { tools: true, timeoutMs: 10_000 };

/** The config file the CLI ran under, as the fake logged it. */
const configSchema = z.object({
	permissions: z.object({ allow: z.array(z.string()), deny: z.array(z.string()) })
});

/** The local MCP config of the CLI's working directory, as the fake logged it. */
const serversSchema = z.object({
	mcpServers: z.record(z.string(), z.object({ url: z.string(), transport: z.string() }))
});

/** A run on the fake CLI in `mode`, with its events collected and the path of the fake's log. */
async function openRun(
	mode = 'reply',
	userConfig?: Record<string, unknown>
): Promise<{ run: AgentRun; events: AgentEvent[]; log: string }> {
	const env = await fakeDevin({ FAKE_DEVIN_MODE: mode }, userConfig);

	const { run, events } = await openCollectingRun(new DevinAgent(env), {
		model: 'swe-2-high',
		system: 'Review the diff.',
		tools: ['read_diff']
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

		const config = configSchema.parse(JSON.parse(logged(text, 'config')));
		const servers = serversSchema.parse(JSON.parse(logged(text, 'mcp')));
		const [name] = Object.keys(servers.mcpServers);

		expect(config.permissions).toEqual({ allow: [`mcp__${name}__*`], deny: ['read', 'edit', 'grep', 'glob', 'exec'] });

		expect(servers.mcpServers[name]).toMatchObject({
			transport: 'http',
			url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:/)
		});

		expect(text).toContain('[-p] [--permission-mode] [auto]');
		expect(text).toContain('[--model] [swe-2-high]');
	});

	test('runs under a config of only the org, with the user’s hooks and MCP servers left out and imports off', async () => {
		const { run, log } = await openRun('reply', {
			version: 1,
			devin: { org_id: 'org-1' },
			hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'touch /tmp/pwned' }] }] },
			mcpServers: { mine: { command: 'my-server' } },
			read_config_from: { claude: true }
		});

		await run.prompt('Review it.', PROMPT);

		const text = await readFile(log, 'utf8');

		await run.close();

		const config: unknown = JSON.parse(logged(text, 'config'));

		expect(config).toEqual({
			version: 1,
			devin: { org_id: 'org-1' },
			read_config_from: {
				cursor: false,
				windsurf: false,
				claude: false,
				opencode: false,
				zed: false,
				copilot: false,
				agents_standard: false,
				cloud: false
			},
			permissions: expect.any(Object)
		});
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

	testPromptFailures(openRun, [
		{ mode: 'signedout', status: 401, message: /signed out/ },
		{ mode: 'limited', status: 429, message: /free model rate limit/, usageLimit: true },
		{ mode: 'crash', status: 0, message: /boom/ }
	]);

	testPromptStops(() => openRun('spawn'));

	test('closing the run deletes the session the CLI saved', async () => {
		const { run, log } = await openRun();

		await run.prompt('Review it.', PROMPT);
		await run.close();

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
