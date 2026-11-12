import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import type { TokenUsage } from '@recoder/shared';
import type { AgentEvent, AgentRun } from '../../../src/agents/contract';
import { CustomCommandAgent } from '../../../src/agents/custom/custom-command';
import { requestSchema } from '../../../src/agents/custom/custom-protocol';
import type { ChatOptions } from '../../../src/models/llm/types';
import { fakeCustomCalls, fakeCustomCommand } from '../../helpers/fake-custom-command';
import { fixtureReview, testPromptStops } from '../../helpers/native-agent';

const PROMPT = { tools: true, timeoutMs: 10_000 };

function call(overrides: Partial<ChatOptions> = {}): ChatOptions {
	return {
		provider: 'custom-command',
		baseUrl: '',
		apiKey: '',
		model: 'fast',
		messages: [
			{ role: 'system', content: 'Summarize.' },
			{ role: 'user', content: 'The diff.' }
		],
		...overrides
	};
}

/** A run on the fake command in `mode`, with its events collected and the fake's log. */
async function openRun(
	mode = 'answer',
	config: Record<string, unknown> = {}
): Promise<{ run: AgentRun; events: AgentEvent[]; log: string }> {
	const env = await fakeCustomCommand({ FAKE_AGENT_MODE: mode }, config);
	const events: AgentEvent[] = [];

	const run = await new CustomCommandAgent(env).openRun({
		model: 'deep',
		reasoningEffort: 'high',
		system: 'Review.',
		tools: ['read_diff'],
		runTool: async () => ({ text: 'the patch', isError: false }),
		onEvent: (event) => events.push(event),
		signal: new AbortController().signal
	});

	return { run, events, log: env.FAKE_AGENT_LOG };
}

/** The error a prompt in `mode` ends with. */
async function failure(mode: string, config: Record<string, unknown> = {}) {
	const { run } = await openRun(mode, config);
	const reply = await run.prompt('Review it.', PROMPT);

	await run.close();

	return reply.error;
}

describe('CustomCommandAgent configuration', () => {
	test('an unset command is not installed and one that is not an argv array is invalid', async () => {
		const unset = await new CustomCommandAgent({ PATH: '/bin' }).detect();
		const shellString = await new CustomCommandAgent({ RECODER_CUSTOM_AGENT: '{"argv":"my-agent --x"}' }).detect();

		expect(unset).toMatchObject({ installed: false, error: null });
		expect(shellString.error).toContain('argv');
	});

	test('a configured command reports the version its describe gives, and lists its models', async () => {
		const agent = new CustomCommandAgent(await fakeCustomCommand());

		const status = await agent.detect();
		const models = await agent.models();

		expect(status).toMatchObject({ installed: true, name: 'My agent', version: '0.4.1', error: null });
		expect(models.map((model) => model.id)).toEqual(['custom-command:fast', 'custom-command:deep']);
		expect(agent.modelSettings('deep', 'medium')).toEqual({ reasoningEffort: 'high' });
	});

	test('the arguments reach the command as given, with no shell to interpolate them', async () => {
		const env = await fakeCustomCommand({}, { argv: ['my-agent', '$(touch pwned)', '; echo hi'] });

		await new CustomCommandAgent(env).complete(call());

		const [{ argv }] = await fakeCustomCalls(env.FAKE_AGENT_LOG);

		expect(argv).toEqual(['$(touch pwned)', '; echo hi']);
	});
});

describe('CustomCommandAgent.complete', () => {
	test('sends a valid tool-less request, streams the text and sums the usage, without the server’s secrets', async () => {
		const env = await fakeCustomCommand({ GH_TOKEN: 'ghp_secret', OPENAI_API_KEY: 'sk-secret' });
		const tokens: string[] = [];
		let usage: TokenUsage | undefined;

		const text = await new CustomCommandAgent(env).complete(call({ onUsage: (u) => (usage = u) }), (t) =>
			tokens.push(t)
		);

		const [{ request }] = await fakeCustomCalls(env.FAKE_AGENT_LOG);
		const childEnv = await readFile(`${env.FAKE_AGENT_LOG}.env`, 'utf8');

		expect(requestSchema.parse(request)).toMatchObject({ kind: 'turn', tools: [], mcp: null, model: 'fast' });
		expect(tokens.join('')).toBe(text);
		expect(usage).toMatchObject({ inputTokens: 40, outputTokens: 8, totalTokens: 48 });
		expect(childEnv).not.toContain('secret');
		expect(childEnv).not.toContain('RECODER_CUSTOM_AGENT');
	});
});

describe('CustomCommandAgent.openRun', () => {
	test('a turn reports its step, reasoning, text and usage as the contract’s events', async () => {
		const { run, events } = await openRun();

		const reply = await run.prompt('Review it.', PROMPT);

		await run.close();

		expect(events.filter((event) => !event.type.startsWith('tool'))).toEqual([
			{ type: 'step-start', step: 'call-1' },
			{ type: 'reasoning', delta: 'Thinking.', partId: 'custom_1' },
			{ type: 'text', delta: reply.text, partId: 'custom_1' },
			{ type: 'usage', step: 'call-1', usage: expect.objectContaining({ inputTokens: 40, outputTokens: 8 }) }
		]);
	});

	test('a later turn carries the conversation so far and the session the last result returned', async () => {
		const { run, log } = await openRun();

		await run.prompt('Review it.', PROMPT);
		await run.prompt('Continue.', PROMPT);
		await run.close();

		const [, second] = await fakeCustomCalls(log);
		const request = requestSchema.parse(second.request);

		expect(request).toMatchObject({ session: 'session-1', reasoningEffort: 'high' });

		expect(request.kind === 'turn' && request.messages.map((message) => message.role)).toEqual([
			'user',
			'assistant',
			'user'
		]);

		expect(request.kind === 'turn' && request.tools.map((tool) => tool.name)).toEqual(['read_diff']);
	});

	test.each([
		['notjson', /not JSON: "hello there"/],
		['version2', /protocol version 2; Recoder speaks version 1/],
		['invalid', /invalid event \(text:/],
		['after', /more after its last event/],
		['noresult', /without a result/],
		['crash', /exited with code 3: boom: the model server is down/]
	])('%s output fails the turn with a clear error', async (mode, message) => {
		expect((await failure(mode))?.message).toMatch(message);
	});

	test('an auth error asks to sign in and a spent plan is a usage limit', async () => {
		const auth = await failure('auth');
		const limit = await failure('limit');

		expect([auth?.status, limit?.status]).toEqual([401, 402]);
		expect(auth?.message).toContain('not signed in: run my-agent login');
	});

	test('output past the configured cap stops the command', async () => {
		expect((await failure('flood', { maxOutputBytes: 100_000 }))?.message).toMatch(/more than 100000 bytes/);
	});

	testPromptStops(() => openRun('spawn'));
});

test('a review agent on a custom command completes through the shared engine, reading evidence through the gate', async () => {
	const { error, read } = await fixtureReview(new CustomCommandAgent(await fakeCustomCommand()), 'fast');

	expect(error).toBeUndefined();
	expect(read).toMatchObject({ isError: false, text: expect.stringContaining('+new') });
});
