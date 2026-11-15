import { expect, test } from 'bun:test';
import { useFakeOpenCode } from '../../helpers/fake-opencode';
import { calls } from '../../helpers/opencode-chat';

const start = useFakeOpenCode();

test('agent sessions bind before prompting and keep shared tool names out of their prompt text', async () => {
	const agent = await start();

	const options = {
		model: 'openai/m',
		system: 'Review this change.',
		tools: ['search'],
		onEvent: () => {},
		signal: new AbortController().signal
	};

	const first = await agent.openRun({
		...options,
		runTool: async () => ({ text: 'first', isError: false })
	});

	const second = await agent.openRun({
		...options,
		runTool: async () => ({ text: 'second', isError: false })
	});

	const text = JSON.stringify({ steps: [[{ tool: 'search', args: {} }]], answer: { done: true } });
	const prompt = { tools: true, timeoutMs: 10000, schema: { name: 'answer', schema: { type: 'object' } } };

	try {
		const replies = await Promise.all([first.prompt(text, prompt), second.prompt(text, prompt)]);

		expect(replies.map((reply) => reply.structured)).toEqual([
			{ done: true, results: [{ text: 'first', isError: false }] },
			{ done: true, results: [{ text: 'second', isError: false }] }
		]);

		const messages = (await calls(agent)).filter((call) => call.path.endsWith('/message'));

		expect(messages.map((call) => call.body?.tools)).toEqual([messages[0].body?.tools, messages[0].body?.tools]);
		expect(messages.map((call) => call.body?.system)).toEqual([options.system, options.system]);
		expect(messages.map((call) => call.body?.parts)).toEqual([[{ type: 'text', text }], [{ type: 'text', text }]]);
	} finally {
		await Promise.all([first.close(), second.close()]);
	}
});

test('final prompts retain the tool catalog and opening diagnostics while refusing calls', async () => {
	const agent = await start();
	const events: import('../../../src/agents/contract').AgentEvent[] = [];
	let executed = 0;

	const run = await agent.openRun({
		model: 'openai/m',
		system: 'Shared system',
		tools: ['search'],
		onEvent: (event) => events.push(event),
		signal: new AbortController().signal,
		runTool: async () => {
			executed++;

			return { text: 'found', isError: false };
		}
	});

	const text = JSON.stringify({ steps: [[{ tool: 'search', args: {} }]], answer: { done: true } });

	try {
		await run.prompt(text, { tools: true, timeoutMs: 10000 });
		await run.prompt(text + ' ', { tools: false, timeoutMs: 10000 });

		const messages = (await calls(agent)).filter((call) => call.path.endsWith('/message'));
		const starts = events.filter((event) => event.type === 'prompt-start');

		expect(messages).toHaveLength(2);
		expect(messages[0].body?.tools).toEqual(messages[1].body?.tools);
		expect(executed).toBe(1);
		expect(starts[0].prefix).toEqual(starts[1].prefix);
		expect(starts[0].prefix?.opening).toBe(new Bun.CryptoHasher('sha256').update(text).digest('hex').slice(0, 16));
	} finally {
		await run.close();
	}
});
