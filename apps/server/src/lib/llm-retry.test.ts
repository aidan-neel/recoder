import { afterAll, expect, test } from 'bun:test';
import { chatCompletion, isTransientLlmError, LlmError } from './llm';

let hits = 0;
const server = Bun.serve({
	port: 0,
	fetch(req, srv) {
		hits++;
		// First two requests: drop the socket like a restarting vLLM would.
		if (hits <= 2) { srv.requestIP(req); throw new Error('drop'); }
		return Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
	},
	error() {
		return new Response('upstream reset', { status: 502 });
	}
});
const savedRetries = process.env.RECODER_LLM_RETRIES;
afterAll(() => {
	server.stop(true);
	if (savedRetries === undefined) delete process.env.RECODER_LLM_RETRIES;
	else process.env.RECODER_LLM_RETRIES = savedRetries;
});

test('retries transient failures until the endpoint answers', async () => {
	process.env.RECODER_LLM_RETRIES = '3';
	const text = await chatCompletion({ baseUrl: `http://localhost:${server.port}`, apiKey: '', model: 'm', messages: [{ role: 'user', content: 'hi' }], timeoutMs: 30_000 });
	expect(text).toBe('ok');
	expect(hits).toBe(3);
}, 20_000);

test('classifies which errors are worth retrying', () => {
	expect(isTransientLlmError(new LlmError(0, 'The socket connection was closed unexpectedly. For more information, pass `verbose: true`'))).toBe(true);
	expect(isTransientLlmError(new LlmError(503, 'LLM 503: overloaded'))).toBe(true);
	expect(isTransientLlmError(new LlmError(400, 'LLM 400: bad request'))).toBe(false);
	expect(isTransientLlmError(new LlmError(0, 'Model request cancelled'))).toBe(false);
	expect(isTransientLlmError(new LlmError(0, 'Model output truncated at the output-token limit'))).toBe(false);
});

test('a stream that goes silent is cut off and retried instead of hanging', async () => {
	let calls = 0;
	const silent = Bun.serve({
		port: 0,
		fetch() {
			calls++;
			if (calls === 1) {
				// One chunk of reasoning, then nothing: the socket stays open.
				return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n')); } }), { headers: { 'content-type': 'text/event-stream' } });
			}
			return Response.json({ choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] });
		}
	});
	process.env.RECODER_LLM_RETRIES = '2';
	process.env.RECODER_LLM_IDLE_MS = '1500';
	try {
		const started = Date.now();
		const text = await chatCompletion({ baseUrl: `http://localhost:${silent.port}`, apiKey: '', model: 'm', messages: [{ role: 'user', content: 'hi' }], timeoutMs: 60_000, onReasoning: () => {} });
		expect(text).toBe('done');
		expect(calls).toBe(2);
		expect(Date.now() - started).toBeLessThan(10_000);
	} finally {
		delete process.env.RECODER_LLM_IDLE_MS;
		silent.stop(true);
	}
}, 20_000);

test('thinking:false sends the vLLM switch, and drops it for endpoints that refuse it', async () => {
	const seen: boolean[] = [];
	const strict = Bun.serve({
		port: 0,
		async fetch(req) {
			const body = await req.json() as { chat_template_kwargs?: unknown };
			seen.push('chat_template_kwargs' in body);
			if (body.chat_template_kwargs) return new Response('Unrecognized request argument supplied: chat_template_kwargs', { status: 400 });
			return Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
		}
	});
	try {
		const opts = { baseUrl: `http://localhost:${strict.port}`, apiKey: '', model: 'm', messages: [{ role: 'user' as const, content: 'hi' }], thinking: false };
		expect(await chatCompletion(opts)).toBe('ok');
		expect(await chatCompletion(opts)).toBe('ok');
		expect(seen).toEqual([true, false, false]);
	} finally {
		strict.stop(true);
	}
});
