import { expect, test } from 'bun:test';
import { app } from '../app';
import { db, reviewProgress } from '../store';
import { emitReviewEvent, listenerCount, reportReviewTask, reportReviewReasoning, reportReviewTool, reviewEventBuffer, trackReviewTask } from './events';
import { chatCompletion, resetLlmLimiter } from './llm';
import { applyProgressMessage, emptyReviewProgress, taskSummary } from '../../../web/src/lib/review-progress-state';

test('streamed traces match persisted reconnect snapshots and keep assignment ownership', () => {
	const id = crypto.randomUUID();
	const first = { id: 'turn-a', assignmentId: 'correctness-a', role: 'correctness', text: 'First' };
	reportReviewReasoning(id, first);
	const startedAt = reviewProgress.get(id)!.reasoning![0].at;
	reportReviewReasoning(id, { ...first, text: 'First update' });
	reportReviewReasoning(id, { ...first, id: 'turn-b', assignmentId: 'correctness-b', text: 'Different assignment' });
	const tool = { id: 'tool-a', assignmentId: 'correctness-a', role: 'correctness', command: 'readDiff src/a.ts', status: 'running' as const, exitCode: null, startedAt };
	reportReviewTool(id, tool);
	reportReviewTool(id, { ...tool, status: 'done', elapsedMs: 31, finishedAt: startedAt,
		input: { action: 'readDiff', path: 'src/a.ts' }, result: { content: '-old\n+new', truncated: false, evidenceId: 'ev_1' }
	});
	let client = emptyReviewProgress(id);
	for (const event of reviewEventBuffer(id)) client = applyProgressMessage(client, event);
	const stored = reviewProgress.get(id)!;
	expect(client).toEqual(stored);
	expect(client.reasoning).toHaveLength(2);
	expect(client.reasoning![0]).toMatchObject({ at: startedAt, text: 'First update', assignmentId: 'correctness-a' });
	expect(client.toolCalls).toHaveLength(1);
	expect(client.toolCalls![0].result?.content).toBe('-old\n+new');
	expect(client.activity).toHaveLength(1);
	expect(applyProgressMessage(emptyReviewProgress(id), { type: 'snapshot', snapshot: stored })).toEqual(client);
});

test('terminal SSE delivers final findings and stays connected for subsequent conversation', async () => {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	const review = { id, repoId: 'test', prNumber: 1, headSha: 'abc', status: 'running' as const, summary: null,
		findings: [], runs: [], source: 'github' as const, prTitle: 'Test', prUrl: null, createdAt: now, updatedAt: now };
	db.reviews.set(review);
	const response = await app.request(`/api/reviews/${id}/events`);
	const reader = response.body!.getReader();
	await reader.read();
	const final = { ...review, status: 'passed' as const, summary: 'Review complete',
		findings: [{ id: 'finding-1', file: 'a.ts', line: 1, severity: 'warning' as const, message: 'Check caller' }] };
	db.reviews.set(final);
	emitReviewEvent(id, { type: 'done', message: 'Review complete', data: { outcome: 'complete' } });
	const event = JSON.parse(new TextDecoder().decode((await reader.read()).value).slice(6).trim());
	expect(event.review).toEqual(final);
	expect(event.snapshot.outcome).toBe('complete');
	expect(applyProgressMessage(emptyReviewProgress(id), event)).toEqual(event.snapshot);
	expect(listenerCount(id)).toBe(1);
	emitReviewEvent(id, { type: 'message', step: 'chat', message: '', data: { chatMessage: {
		id: 'reply', assignmentId: '__pipeline', from: 'assistant', text: 'Follow-up answer', at: now, status: 'done'
	} } });
	const reply = JSON.parse(new TextDecoder().decode((await reader.read()).value).slice(6).trim());
	expect(reply.data.chatMessage.text).toBe('Follow-up answer');
	await reader.cancel();
	expect(listenerCount(id)).toBe(0);
});

test('task snapshots retain early completions after event history overflows', () => {
	const id = crypto.randomUUID();
	reportReviewTask(id, { id: 'early', agent: 'security', label: 'Scout 1', status: 'done', message: 'Completed' });
	for (let i = 0; i < 410; i++) emitReviewEvent(id, { type: 'log', message: 'Activity ' + i });
	expect(reviewEventBuffer(id)).toHaveLength(400);
	expect(reviewProgress.get(id)?.tasks.early.status).toBe('done');
	expect(reviewProgress.get(id)?.activity.length).toBeLessThanOrEqual(100);
});

test('reconnecting starts with a complete snapshot and cancelling unsubscribes', async () => {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	db.reviews.set({
		id, repoId: 'test', prNumber: 1, headSha: 'abc', status: 'running', summary: null,
		findings: [], runs: [], source: 'github', prTitle: 'Test', prUrl: null, createdAt: now, updatedAt: now
	});
	reportReviewTask(id, { id: 'fetch', label: 'Metadata', status: 'done', message: 'Fetched' });
	const response = await app.request('/api/reviews/' + id + '/events');
	const reader = response.body!.getReader();
	const first = new TextDecoder().decode((await reader.read()).value);
	const event = JSON.parse(first.slice(6).trim());
	expect(event.type).toBe('snapshot');
	expect(event.snapshot.tasks.fetch.status).toBe('done');
	expect(listenerCount(id)).toBe(1);
	await reader.cancel();
	expect(listenerCount(id)).toBe(0);
	db.reviews.set({ ...db.reviews.get(id)!, status: 'failed', summary: 'Server restarted' });
	const completed = await app.request('/api/reviews/' + id + '/events');
	const completedReader = completed.body!.getReader();
	const terminal = JSON.parse(new TextDecoder().decode((await completedReader.read()).value).slice(6).trim());
	expect(terminal.status).toBe('failed');
	expect(listenerCount(id)).toBe(1);
	await completedReader.cancel();
	expect(listenerCount(id)).toBe(0);
});

test('a real HTTP subscription survives idle periods and still delivers review and chat updates', async () => {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	const review = { id, repoId: 'test', prNumber: 1, headSha: 'abc', status: 'running' as const, summary: null,
		findings: [], runs: [], source: 'github' as const, prTitle: 'SSE liveness', prUrl: null, createdAt: now, updatedAt: now };
	db.reviews.set(review);
	const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: app.fetch });
	const controller = new AbortController();
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	try {
		const response = await fetch(new URL(`/api/reviews/${id}/events`, server.url), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(18_000)]) });
		reader = response.body!.getReader();
		const read = async () => JSON.parse(new TextDecoder().decode((await reader!.read()).value).slice(6).trim());
		expect((await read()).type).toBe('snapshot');
		expect(await read()).toMatchObject({ type: 'heartbeat', status: 'running' });
		expect(await read()).toMatchObject({ type: 'heartbeat', status: 'running' });
		expect(listenerCount(id)).toBe(1);
		db.reviews.set({ ...review, status: 'passed' });
		emitReviewEvent(id, { type: 'done', message: 'Complete' });
		expect((await read()).review.status).toBe('passed');
		emitReviewEvent(id, { type: 'message', step: 'chat', message: '', data: { chatMessage: {
			id: 'after-idle', assignmentId: '__pipeline', from: 'assistant', text: 'Still connected.', at: now, status: 'done'
		} } });
		expect((await read()).data.chatMessage.text).toBe('Still connected.');
		// Bun's fetch keeps the socket open after reader.cancel(); abort to actually disconnect.
		controller.abort();
		await new Promise(resolve => setTimeout(resolve, 20));
		expect(listenerCount(id)).toBe(0);
	} finally {
		controller.abort();
		await reader?.cancel().catch(() => {});
		server.stop(true);
		db.reviews.delete(id);
	}
}, 20_000);

test('plan and assignment snapshots stay readable for older clients', () => {
	const assignment = {
		id: 'correctness-core', role: 'correctness', title: 'Correctness', reason: 'behavior',
		status: 'running' as const, scope: [{ path: 'a.ts', hunkIds: ['a.ts:1,1:1,1'] }], candidateCount: 0
	};
	const event = {
		type: 'plan', sequence: 2, message: 'Planning', at: new Date().toISOString(),
		data: { planVersion: 1, planSummary: 'two specialists', assignments: [assignment], candidateCount: 0 }
	};
	const next = applyProgressMessage(emptyReviewProgress('review'), event);
	expect(next.planVersion).toBe(1);
	expect(next.assignments?.[0].id).toBe('correctness-core');
	expect(next.assignments?.[0].id).not.toBe(next.assignments?.[0].role);
});

test('client ignores duplicate events and retains failed work separately from completion', () => {
	const task = { id: 'security:1:scout:0', label: 'Scout 1', status: 'error' as const, message: 'Timed out', updatedAt: new Date().toISOString() };
	const event = { type: 'task', sequence: 1, message: task.message, at: task.updatedAt, data: { task } };
	const first = applyProgressMessage(emptyReviewProgress('review'), event);
	expect(applyProgressMessage(first, event)).toBe(first);
	expect(taskSummary(Object.values(first.tasks))).toEqual({ done: 0, failed: 1, running: 0, total: 1, settled: 1 });
	const restored = applyProgressMessage(emptyReviewProgress('review'), { type: 'snapshot', snapshot: first });
	expect(restored.tasks[task.id].status).toBe('error');
});

test('opaque operation failures leave an explicit failed task', async () => {
	const id = crypto.randomUUID();
	await expect(trackReviewTask(id, 'sandbox', 'Preparing checkout', async () => { throw new Error('Clone failed'); })).rejects.toThrow('Clone failed');
	expect(reviewProgress.get(id)?.tasks.sandbox).toMatchObject({ status: 'error', message: 'Clone failed' });
});

test('model progress distinguishes concurrency queue from an active request', async () => {
	const oldFetch = globalThis.fetch;
	const oldLimit = process.env.RECODER_LLM_CONCURRENCY;
	process.env.RECODER_LLM_CONCURRENCY = '1';
	resetLlmLimiter();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => release = resolve);
	let requests = 0;
	globalThis.fetch = (async () => {
		if (++requests === 1) await gate;
		return Response.json({ choices: [{ message: { content: '[]' } }] });
	}) as unknown as typeof fetch;
	const states: string[] = [];
	try {
		const opts = { baseUrl: 'http://test', apiKey: 'test', model: 'test', messages: [] };
		const first = chatCompletion(opts);
		const second = chatCompletion({ ...opts, onProgress: (state) => states.push(state) });
		await Promise.resolve();
		expect(states).toEqual(['queued']);
		release();
		await Promise.all([first, second]);
		expect(states).toEqual(['queued', 'running']);
	} finally {
		release();
		globalThis.fetch = oldFetch;
		if (oldLimit === undefined) delete process.env.RECODER_LLM_CONCURRENCY;
		else process.env.RECODER_LLM_CONCURRENCY = oldLimit;
		resetLlmLimiter();
	}
});
