import { expect, test } from 'bun:test';
import { app } from '../app';
import { db, reviewProgress } from '../store';
import { emitReviewEvent, listenerCount, reportReviewTask, reviewEventBuffer, trackReviewTask } from './events';
import { chatCompletion, resetLlmLimiter } from './llm';
import { applyProgressMessage, emptyReviewProgress, taskSummary } from '../../../web/src/lib/review-progress-state';

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
	expect((await completedReader.read()).done).toBe(true);
	expect(listenerCount(id)).toBe(0);
});

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
