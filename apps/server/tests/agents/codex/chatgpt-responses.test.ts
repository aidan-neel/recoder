import { afterEach, expect, test } from 'bun:test';
import { ChatConversation, LlmError } from '../../../src/models/llm';
import { configForSubagent } from '../../../src/models/models';
import { setReviewOverrides } from '../../../src/review/session/review-settings';
import {
	cancellableCompletion,
	cleanupFixtures,
	completeEvent,
	finalItem,
	fixture,
	input,
	sse,
	until,
	usage
} from './chatgpt-fixture';

afterEach(cleanupFixtures);

test('direct Responses requests preserve roles and effort without unsupported API-key parameters', async () => {
	const f = fixture();

	await f.provider.complete({
		...input,
		jsonMode: true,
		maxTokens: 123,
		temperature: 0.1,
		seed: 7,
		messages: [
			{ role: 'system', content: 'Review carefully' },
			{ role: 'user', content: 'Change' },
			{ role: 'assistant', content: 'Earlier answer' },
			{ role: 'user', content: 'Follow up' }
		]
	});

	const call = f.calls.find((call) => call.url.endsWith('/responses'))!;
	const body = call.body as { instructions: string; input: { role: string; content: unknown }[] };

	expect(call.url).toBe('https://chatgpt.com/backend-api/codex/responses');

	expect(call.body).toMatchObject({
		model: 'test-model',
		store: false,
		stream: true,
		reasoning: { effort: 'low' },
		tools: [],
		tool_choice: 'none'
	});

	expect(body.instructions).toContain('Review carefully');
	expect(body.instructions).toContain('valid JSON');
	expect(body.input.map((item) => item.role)).toEqual(['user', 'assistant', 'user']);
	expect(body.input[1]!.content).toEqual([{ type: 'output_text', text: 'Earlier answer' }]);
	for (const key of ['max_output_tokens', 'max_tokens', 'temperature', 'seed']) expect(call.body[key]).toBeUndefined();
});

test('calls of one conversation share a prompt cache key that another conversation does not', async () => {
	const f = fixture();
	const [first, second] = [new ChatConversation(), new ChatConversation()];

	for (const conversation of [first, first, second]) await f.provider.complete({ ...input, conversation });

	const keys = f.calls.filter((call) => call.url.endsWith('/responses')).map((call) => call.body.prompt_cache_key);

	expect(keys).toEqual([first.id, first.id, second.id]);
});

test.each(['low', 'medium', 'high'] as const)(
	'direct model request consumes the persisted Specialist effort %s',
	async (reasoningEffort) => {
		setReviewOverrides({
			models: [{ id: 'sub', label: 'ChatGPT', model: 'test-model', provider: 'codex' }],
			specialistEffort: reasoningEffort
		});

		const f = fixture();

		await f.provider.complete({ ...input, ...configForSubagent() });

		expect(f.calls.find((call) => call.url.endsWith('/responses'))!.body).toMatchObject({
			reasoning: { effort: reasoningEffort }
		});
	}
);

test('fragmented SSE streams only final-answer text and reports exact cache/reasoning usage once', async () => {
	const commentary = { id: 'commentary', type: 'message', role: 'assistant', phase: 'commentary' };

	const events = [
		{ type: 'response.output_item.added', item: commentary },
		{ type: 'response.output_text.delta', item_id: 'commentary', delta: 'not the answer' },
		{ type: 'response.reasoning_text.delta', delta: 'private reasoning' },
		{ type: 'response.output_item.added', item: { ...finalItem, content: [] } },
		{ type: 'response.output_text.delta', item_id: 'answer', delta: 'Hé' },
		{ type: 'response.output_text.delta', item_id: 'answer', delta: 'llo' },
		completeEvent({ usage, output: [{ ...finalItem, content: [{ type: 'output_text', text: 'Héllo' }] }] })
	];

	const wire = events
		.map((event) => `: heartbeat\r\nevent: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`)
		.join('');

	const f = fixture({
		handler: (call) =>
			call.url.endsWith('/responses')
				? new Response(
						new ReadableStream({
							start(controller) {
								const bytes = new TextEncoder().encode(wire);

								for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
								controller.close();
							}
						})
					)
				: undefined
	});

	const output: string[] = [];
	const reports: unknown[] = [];

	expect(
		await f.provider.complete({ ...input, onUsage: (value) => reports.push(value) }, (value) => output.push(value))
	).toBe('Héllo');

	expect(output).toEqual(['Hé', 'llo']);

	expect(reports).toEqual([
		{
			inputTokens: 100,
			outputTokens: 30,
			totalTokens: 130,
			cachedInputTokens: 20,
			cacheWriteInputTokens: 5,
			reasoningOutputTokens: 10
		}
	]);
});

test('terminal SSE without trailing newline keeps output; missing usage is not fabricated', async () => {
	const f = fixture({
		handler: (call) =>
			call.url.endsWith('/responses') ? new Response(`data: ${JSON.stringify(completeEvent())}`) : undefined
	});

	const reports: unknown[] = [];

	expect(await f.provider.complete({ ...input, onUsage: (value) => reports.push(value) })).toBe('{"findings":[]}');
	expect(reports).toEqual([]);
});

test('ChatGPT requests reasoning summaries and deduplicates delta, done and terminal representations', async () => {
	const item = { id: 'reasoning-1', type: 'reasoning', summary: [{ type: 'summary_text', text: 'Checking callers.' }] };

	const f = fixture({
		handler: (call) =>
			call.url.endsWith('/responses')
				? sse([
						{ type: 'response.reasoning_summary_text.delta', item_id: item.id, summary_index: 0, delta: 'Checking ' },
						{ type: 'response.reasoning_summary_text.delta', item_id: item.id, summary_index: 0, delta: 'callers.' },
						{
							type: 'response.reasoning_summary_text.done',
							item_id: item.id,
							summary_index: 0,
							text: 'Checking callers.'
						},
						{ type: 'response.output_item.done', item },
						completeEvent({
							output: [
								item,
								{
									id: 'reasoning-2',
									type: 'reasoning',
									summary: [{ type: 'summary_text', text: 'Compared the old behavior.' }]
								},
								finalItem
							]
						})
					])
				: undefined
	});

	const reasoning: string[] = [];

	expect(await f.provider.complete({ ...input, onReasoning: (text) => reasoning.push(text) })).toBe('{"findings":[]}');

	expect(f.calls.find((call) => call.url.endsWith('/responses'))!.body).toMatchObject({
		reasoning: { summary: 'auto' }
	});

	expect(reasoning.join('')).toBe('Checking callers.\n\nCompared the old behavior.');
});

test.each(['response.failed', 'response.incomplete'])('%s retains usage but rejects partial output', async (type) => {
	const f = fixture({
		handler: (call) =>
			call.url.endsWith('/responses')
				? sse([{ type, response: { usage, status: 'failed', incomplete_details: { reason: 'max_output_tokens' } } }])
				: undefined
	});

	const reports: unknown[] = [];

	await expect(f.provider.complete({ ...input, onUsage: (value) => reports.push(value) })).rejects.toBeInstanceOf(
		LlmError
	);

	expect(reports).toHaveLength(1);
	expect(reports[0]).toMatchObject({ totalTokens: 130 });
});

test('truncated streams and malformed SSE cannot be mistaken for successful responses', async () => {
	for (const wire of [
		'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
		'data: [DONE]\n\n',
		'data: invalid-json\n\n'
	]) {
		const f = fixture({ handler: (call) => (call.url.endsWith('/responses') ? new Response(wire) : undefined) });

		await expect(f.provider.complete(input)).rejects.toBeInstanceOf(LlmError);
	}
});

test('abort cancels streaming and releases the active request; disconnect waits for completion', async () => {
	let cancelled = false;

	const f = fixture({
		handler: (call) =>
			call.url.endsWith('/responses')
				? new Response(
						new ReadableStream({
							cancel() {
								cancelled = true;
							}
						})
					)
				: undefined
	});

	const { controller, outcome } = cancellableCompletion(f.provider);

	await until(() => f.calls.some((call) => call.url.endsWith('/responses')));
	await expect(f.provider.disconnect()).rejects.toThrow('active ChatGPT');
	controller.abort();
	expect(await outcome).toContain('cancelled');
	expect(cancelled).toBe(true);
	await f.provider.disconnect();
});
