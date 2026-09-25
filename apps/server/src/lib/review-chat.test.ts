import { afterEach, expect, test } from 'bun:test';
import { ORCHESTRATOR_ID, emptyReviewProgress } from '@recoder/shared';
import { db, recoverStaleReviews, reviewProgress } from '../store';
import { app } from '../app';
import { discussionContext, startReviewChat, stopReviewChat } from './review-chat';
import { getStoredSettings, setReviewOverrides } from './review-settings';
import { subscribeReview, clearReviewEvents, reviewEventBuffer } from './events';
import { applyProgressMessage } from '../../../web/src/lib/review-progress-state';

const originalFetch = globalThis.fetch;
const originalSettings = getStoredSettings();
const ids: string[] = [];
afterEach(() => {
	globalThis.fetch = originalFetch;
	setReviewOverrides(originalSettings);
	for (const id of ids.splice(0)) { db.reviews.delete(id); clearReviewEvents(id); }
});

function setup() {
	const id = crypto.randomUUID();
	ids.push(id);
	const at = new Date().toISOString();
	db.reviews.set({ id, repoId: 'test', prNumber: 1, headSha: 'abc', status: 'passed', summary: 'Done', findings: [], runs: [], source: 'github', prTitle: 'Review', prUrl: null, createdAt: at, updatedAt: at });
	reviewProgress.set({ ...emptyReviewProgress(id), assignments: [{ id: 'security-auth', role: 'security', title: 'Security', status: 'done', reason: 'Auth changed', scope: [] }] });
	setReviewOverrides({ baseUrl: 'http://model.test/v1', apiKey: 'test', models: [{ id: 'lead', label: 'Lead', model: 'lead' }, { id: 'worker', label: 'Worker', model: 'worker' }], orchestratorModelId: 'lead', specialistModelId: 'worker' });
	return id;
}

function settled(id: string, assignmentId: string) {
	return new Promise<void>((resolve) => {
		const off = subscribeReview(id, (event) => {
			const message = event.data?.chatMessage as { from: string; status: string; assignmentId: string } | undefined;
			if (message?.from === 'assistant' && message.assignmentId === assignmentId && message.status !== 'streaming') { off(); resolve(); }
		}, false);
	});
}

test('server restart settles interrupted replies even on completed reviews', () => {
	const id = setup();
	const progress = reviewProgress.get(id)!;
	reviewProgress.set({ ...progress, messages: [{ id: 'orphan', assignmentId: ORCHESTRATOR_ID, from: 'assistant', text: 'Partial reply', status: 'streaming', at: new Date().toISOString(), discussion: true }] });
	recoverStaleReviews();
	expect(db.reviews.get(id)?.status).toBe('passed');
	expect(reviewProgress.get(id)?.messages?.[0]).toMatchObject({ status: 'error' });
	expect(reviewProgress.get(id)?.messages?.[0].text).toContain('server restart');
});

test('specialist chat streams, persists, and is visible in subsequent orchestrator requests', async () => {
	const id = setup();
	const requests: Array<{ model: string; messages: { content: string }[] }> = [];
	globalThis.fetch = (async (_url, init) => {
		requests.push(JSON.parse(init?.body as string));
		return Response.json({ choices: [{ message: { content: 'The caller checks the token.' } }] });
	}) as typeof fetch;
	const done = settled(id, 'security-auth');
	startReviewChat(id, 'security-auth', 'Is the caller protected?');
	await done;
	expect(requests[0].model).toBe('worker');
	expect(discussionContext(id)).toContain('Is the caller protected?');
	expect(discussionContext(id)).toContain('The caller checks the token.');
	expect(discussionContext(id, 'unrelated-specialist')).toBe('');
	const leadDone = settled(id, ORCHESTRATOR_ID);
	startReviewChat(id, ORCHESTRATOR_ID, 'What did security say?');
	await leadDone;
	expect(requests[1].model).toBe('lead');
	expect(requests[1].messages[1].content).toContain('The caller checks the token.');
	let client = emptyReviewProgress(id);
	for (const event of reviewEventBuffer(id)) client = applyProgressMessage(client, event);
	expect(client.messages).toEqual(reviewProgress.get(id)?.messages);
});

test('unknown targets are rejected and duplicate sends are blocked until stop settles', async () => {
	const id = setup();
	globalThis.fetch = (async (_url, init) => {
		await new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
		return new Response();
	}) as typeof fetch;
	const bad = await app.request(`/api/reviews/${id}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assignmentId: 'missing', text: 'Hello' }) });
	expect(bad.status).toBe(404);
	const done = settled(id, ORCHESTRATOR_ID);
	startReviewChat(id, ORCHESTRATOR_ID, 'Explain');
	expect(() => startReviewChat(id, ORCHESTRATOR_ID, 'Again')).toThrow('still replying');
	await new Promise((resolve) => setTimeout(resolve, 10));
	stopReviewChat(id, ORCHESTRATOR_ID);
	await done;
	expect(reviewProgress.get(id)?.messages?.at(-1)).toMatchObject({ status: 'error', text: 'Reply stopped.' });
});
