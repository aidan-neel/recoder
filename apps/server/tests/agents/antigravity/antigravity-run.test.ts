import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { AntigravityAgent } from '../../../src/agents/antigravity/antigravity';
import type { AgentEvent } from '../../../src/agents/contract';
import { UsageLimitError } from '../../../src/models/llm/errors';
import { JSON_MODE_INSTRUCTION } from '../../../src/models/llm/request-fields';
import { fakeAntigravity, fakeAntigravityCalls } from '../../helpers/fake-antigravity';
import { fixtureReview, testPromptStops } from '../../helpers/native-agent';
import { PROMPT, openRun, type OpenRunOptions } from './antigravity-fixture';

const settingsSchema = z.object({
	toolPermission: z.string(),
	allowNonWorkspaceAccess: z.boolean(),
	disableSlashCommands: z.boolean(),
	modelProvider: z.string(),
	customModelsConfig: z.record(z.string(), z.unknown()),
	permissions: z.object({
		allow: z.array(z.string()),
		deny: z.array(z.string())
	})
});

function after(args: string[], flag: string): string | undefined {
	return args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
}

/** Runs one prompt on a fresh run, closes it, and returns the logged CLI call and parsed session settings. */
async function captureFirstCall(options: OpenRunOptions = {}, text = 'Review it.') {
	const opened = await openRun('answer', options);

	await opened.run.prompt(text, PROMPT);
	await opened.run.close();

	const [logged] = await fakeAntigravityCalls(opened.log);

	if (!logged) throw new Error('expected fake agy to log one invocation');

	return { logged, settings: settingsSchema.parse(logged.settings) };
}

function modelEventTrace(events: readonly AgentEvent[]): AgentEvent[] {
	return events.filter((item) => item.type !== 'activity' && item.type !== 'tool-call' && item.type !== 'tool-result');
}

describe('AntigravityAgent.openRun', () => {
	test('turns built-in tools off, passes only Recoder’s MCP server, and runs in an empty directory', async () => {
		const { logged, settings } = await captureFirstCall();
		const urlMatch = /serverUrl:\s*"([^"]+)"/.exec(logged.agentMd);
		const nameMatch = /mcpServers:\n\s*-\s*name:\s*"([^"]+)"/.exec(logged.agentMd);
		const serverName = nameMatch?.[1] ?? '';

		expect(logged.cwd).toMatch(/\/antigravity-empty$/);

		expect(logged.args).toEqual(
			expect.arrayContaining([
				'--input-format',
				'stream-json',
				'--output-format',
				'stream-json',
				'--disable-slash-commands',
				'--agent',
				'recoder',
				'--model',
				'gemini-3.8-flash',
				'--effort',
				'low'
			])
		);

		expect(serverName).toMatch(/^recoder\d+$/);
		expect(urlMatch?.[1]).toStartWith('http://127.0.0.1:');
		expect(logged.agentMd).toContain('excludeDefaultComponents: true');
		expect(logged.agentMd).toContain('commandExecutionPolicy: "off"');
		expect(logged.agentMd).toContain('tools: []');
		expect(settings.toolPermission).toBe('request-review');
		expect(settings.allowNonWorkspaceAccess).toBe(false);
		expect(settings.permissions.allow).toEqual([`mcp(${serverName}/*)`]);

		expect(settings.permissions.deny).toEqual([
			'command(*)',
			'unsandboxed(*)',
			'read_file(*)',
			'write_file(*)',
			'read_url(*)',
			'execute_url(*)',
			'download_url(*)'
		]);
	});

	test('a run without tools passes no MCP server and denies every MCP tool', async () => {
		const { logged, settings } = await captureFirstCall({ tools: [] }, 'Summarize.');

		expect(logged.agentMd).not.toContain('mcpServers:');
		expect(settings.permissions.allow).toEqual([]);
		expect(settings.permissions.deny).toContain('mcp(*)');
	});

	test('leaves user hooks, MCP servers and provider overrides out of the session config and turns inheritance off', async () => {
		const { logged, settings } = await captureFirstCall({
			user: {
				settings: {
					modelProvider: 'vertex',
					allowNonWorkspaceAccess: true,
					customModelsConfig: { custom: { baseUrl: 'https://evil.example' } }
				},
				hooks: {
					hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'touch /tmp/pwned' }] }] }
				},
				mcpServers: { personal_srv: { serverUrl: 'https://personal.example/mcp' } }
			}
		});

		expect(settings.modelProvider).toBe('');
		expect(settings.customModelsConfig).toEqual({});
		expect(settings.allowNonWorkspaceAccess).toBe(false);
		expect(JSON.stringify(logged.settings)).not.toContain('pwned');
		expect(JSON.stringify(logged.settings)).not.toContain('personal_srv');
		expect(logged.agentMd).not.toContain('personal_srv');
		expect(logged.agentMd).toContain('inheritCustomizations: false');
		expect(logged.agentMd).toContain('inheritMcp: false');
		expect(logged.agentMd).toContain('hooks: []');
		expect(logged.agentMd).toContain('plugins: []');
		expect(logged.agentMd).toContain('rules: []');
		expect(logged.agentMd).toContain('skills: []');
	});

	test('emits paired step-start and usage events with streaming reasoning and text deltas', async () => {
		const session = await openRun('tool');
		const outcome = await session.run.prompt('Inspect diff.', PROMPT);

		await session.run.close();

		const expectedPayload = JSON.stringify({ done: true, results: [{ isError: false, text: 'read read_diff' }] });

		expect(outcome.error).toBeUndefined();
		expect(outcome.text).toBe(expectedPayload);

		expect(modelEventTrace(session.events)).toEqual([
			{ type: 'step-start', step: 'step_1' },
			{ type: 'reasoning', delta: 'Hmm.', partId: 'part_1' },
			{
				type: 'usage',
				step: 'step_1',
				usage: {
					inputTokens: 150,
					outputTokens: 12,
					totalTokens: 162,
					cachedInputTokens: 50,
					cacheWriteInputTokens: null,
					reasoningOutputTokens: 4
				}
			},
			{ type: 'step-start', step: 'step_2' },
			{ type: 'text', delta: expectedPayload, partId: 'part_2' },
			{
				type: 'usage',
				step: 'step_2',
				usage: {
					inputTokens: 200,
					outputTokens: 30,
					totalTokens: 230,
					cachedInputTokens: 0,
					cacheWriteInputTokens: null,
					reasoningOutputTokens: 0
				}
			}
		]);

		expect(outcome.tokens).toEqual({
			inputTokens: 350,
			outputTokens: 42,
			totalTokens: 392,
			cachedInputTokens: 50,
			cacheWriteInputTokens: null,
			reasoningOutputTokens: 4
		});
	});

	test('a later prompt resumes the conversation and counts only its own step usage', async () => {
		const { run, log } = await openRun();

		const firstReply = await run.prompt('Review it.', PROMPT);
		const secondReply = await run.prompt('Continue.', { ...PROMPT, schema: { type: 'object' } });

		await run.close();

		const [first, second] = await fakeAntigravityCalls(log);

		expect(first).toBeDefined();
		expect(second).toBeDefined();
		if (!first || !second) return;

		expect(after(first.args, '--conversation')).toBeUndefined();
		expect(after(second.args, '--conversation')).toBe(first.conversationId);
		expect(second.prompt).toBe(`Continue.\n\n${JSON_MODE_INSTRUCTION}`);
		expect(firstReply.tokens?.inputTokens).toBe(350);
		expect(secondReply.tokens?.inputTokens).toBe(350);
	});

	test('maps signed-out prompts to 401 with login command and usage caps to UsageLimitError', async () => {
		const signedOut = await openRun('auth');
		const limited = await openRun('limit');
		const throttled = await openRun('throttle');

		const [authReply, limitReply, throttleReply] = await Promise.all([
			signedOut.run.prompt('Review it.', PROMPT),
			limited.run.prompt('Review it.', PROMPT),
			throttled.run.prompt('Review it.', PROMPT)
		]);

		await Promise.all([signedOut.run.close(), limited.run.close(), throttled.run.close()]);

		expect(authReply.error?.status).toBe(401);
		expect(authReply.error?.message).toContain('agy acp --login');

		expect(limitReply.error).toBeInstanceOf(UsageLimitError);
		expect(limitReply.error?.status).toBe(429);
		expect(limitReply.error?.message).toContain('resets at 3pm UTC');

		expect(throttleReply.error).not.toBeInstanceOf(UsageLimitError);
		expect(throttleReply.error?.status).toBe(429);
	});

	test('malformed output fails the prompt and redacts bearer credentials from errors and events', async () => {
		const { run, events } = await openRun('garbage');

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		const errorEvents = events.filter((event) => event.type === 'error');

		expect(errorEvents.length).toBeGreaterThan(0);
		expect(JSON.stringify(errorEvents)).not.toContain('sk-antigravity-secret-token-9999');
		expect(reply.error?.message).toContain('could not be parsed');
		expect(reply.error?.message).not.toContain('sk-antigravity-secret-token-9999');
	});

	test('output past the cap stops the CLI with printed more than', async () => {
		const { run } = await openRun('flood');

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		expect(reply.error?.message).toContain('printed more than');
	});

	test('falls back to streamed text when the final response is blank and fails when both are blank', async () => {
		const streamedOnly = await openRun('streamed-only');
		const blankBoth = await openRun('empty');

		const [streamedReply, emptyReply] = await Promise.all([
			streamedOnly.run.prompt('Review it.', PROMPT),
			blankBoth.run.prompt('Review it.', PROMPT)
		]);

		await Promise.all([streamedOnly.run.close(), blankBoth.run.close()]);

		expect(streamedReply.error).toBeUndefined();
		expect(streamedReply.text).toBe('Streamed reply');
		expect(emptyReply.text).toBe('');
		expect(emptyReply.error?.message).toBe('Antigravity ended without a reply.');
	});

	test('fails the prompt when CLI output reports a non-UUID conversation id instead of resuming it', async () => {
		const { run, log } = await openRun('answer', {
			env: { FAKE_ANTIGRAVITY_CONVERSATION_ID: '../bad-id Authorization: Bearer sk-antigravity-secret-9999' }
		});

		const firstReply = await run.prompt('First.', PROMPT);
		const secondReply = await run.prompt('Second.', PROMPT);

		await run.close();

		const [firstCall, secondCall] = await fakeAntigravityCalls(log);

		expect(firstReply.error?.message).toContain('invalid conversation ID');
		expect(firstReply.error?.message).not.toContain('sk-antigravity-secret-9999');
		expect(secondReply.error?.message).toContain('invalid conversation ID');
		expect(firstCall).toBeDefined();
		expect(secondCall).toBeDefined();

		if (secondCall) {
			expect(after(secondCall.args, '--conversation')).toBeUndefined();
		}
	});

	testPromptStops(() => openRun('spawn'));
});

test('a review agent on an Antigravity model completes through the shared engine, reading evidence through the gate', async () => {
	const { error, read } = await fixtureReview(
		new AntigravityAgent(await fakeAntigravity({ FAKE_ANTIGRAVITY_MODE: 'tool' })),
		'gemini-3.8-flash'
	);

	expect(error).toBeUndefined();
	expect(read).toMatchObject({ isError: false, text: expect.stringContaining('+new') });
});
