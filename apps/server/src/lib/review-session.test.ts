import { afterEach, expect, test } from 'bun:test';
import { ORCHESTRATOR_ID, type Review } from '@recoder/shared';
import { app } from '../app';
import { createReviewSession, startReviewSession } from '../commands/pipeline';
import { db, recoverStaleReviews, reviewProgress } from '../store';
import { clearReviewEvents, subscribeReview } from './events';
import { discussionContext, startReviewChat, stopReviewChat } from './review-chat';
import { getStoredSettings, setReviewOverrides } from './review-settings';

const originalFetch = globalThis.fetch;
const originalSettings = getStoredSettings();
const reviewIds: string[] = [];
const repoIds: string[] = [];

afterEach(() => {
	globalThis.fetch = originalFetch;
	setReviewOverrides(originalSettings);
	for (const id of reviewIds.splice(0)) { db.reviews.delete(id); clearReviewEvents(id); }
	for (const id of repoIds.splice(0)) db.repos.delete(id);
});

function setup() {
	const id = crypto.randomUUID();
	repoIds.push(id);
	const at = new Date().toISOString();
	db.repos.set({ id, name: 'demo', url: 'https://github.com/example/demo', provider: 'github', defaultBranch: 'main', createdAt: at, updatedAt: at });
	setReviewOverrides({ baseUrl: 'http://model.test/v1', apiKey: 'test', models: [{ id: 'lead', label: 'Lead', model: 'lead' }], orchestratorModelId: 'lead', specialistModelId: 'lead' });
	return id;
}

function draft(repoId = setup()) {
	const review = createReviewSession({ repoId, prNumber: 42, prTitle: 'Review the feature branch' });
	reviewIds.push(review.id);
	return review;
}

function settled(id: string) {
	return new Promise<void>((resolve) => {
		const off = subscribeReview(id, (event) => {
			const message = event.data?.chatMessage as { from: string; status: string } | undefined;
			if (message?.from === 'assistant' && message.status !== 'streaming') { off(); resolve(); }
		}, false);
	});
}

test('opening the same PR creates distinct persisted drafts with empty chats and no model calls', async () => {
	const repoId = setup();
	let requests = 0;
	globalThis.fetch = (async () => { requests++; throw new Error('Unexpected model call'); }) as unknown as typeof fetch;
	const create = () => app.request('/api/reviews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repoId, prNumber: 42, prTitle: 'Feature branch', start: false }) });
	const first = await create();
	const second = await create();
	expect(first.status).toBe(201);
	expect(second.status).toBe(201);
	const a = await first.json() as Review;
	const b = await second.json() as Review;
	reviewIds.push(a.id, b.id);
	expect(a.id).not.toBe(b.id);
	for (const review of [a, b]) {
		expect(review).toMatchObject({ repoId, prNumber: 42, prTitle: 'Feature branch', status: 'draft' });
		expect(reviewProgress.get(review.id)?.messages ?? []).toEqual([]);
		expect(reviewProgress.get(review.id)?.tasks).toEqual({});
		expect(db.reviews.get(review.id)?.status).toBe('draft');
	}
	expect(requests).toBe(0);
	recoverStaleReviews();
	expect(db.reviews.get(a.id)?.status).toBe('draft');
});

test('a pre-review question gets a reply without starting analysis', async () => {
	const review = draft();
	globalThis.fetch = (async () => Response.json({ choices: [{ message: { content: JSON.stringify({ message: 'Tell me which areas to focus on, then ask me to start.', action: 'reply' }) } }] })) as unknown as typeof fetch;
	const done = settled(review.id);
	startReviewChat(review.id, ORCHESTRATOR_ID, 'What should I tell you before starting?');
	await done;
	expect(db.reviews.get(review.id)?.status).toBe('draft');
	expect(reviewProgress.get(review.id)?.messages?.at(-1)?.text).toBe('Tell me which areas to focus on, then ask me to start.');
	expect(reviewProgress.get(review.id)?.assignments ?? []).toEqual([]);
	expect(reviewProgress.get(review.id)?.tasks).toEqual({});
});

test('SSE announces the transition from an empty draft to a queued review', async () => {
	const review = draft();
	db.repos.delete(review.repoId);
	const response = await app.request(`/api/reviews/${review.id}/events`);
	const reader = response.body!.getReader();
	const decode = (value: Uint8Array) => JSON.parse(new TextDecoder().decode(value).replace(/^data: /, '').trim());
	try {
		const first = await reader.read();
		expect(decode(first.value!).review.status).toBe('draft');
		const terminal = new Promise<void>((resolve) => {
			const off = subscribeReview(review.id, event => { if (event.type === 'error' && !event.step) { off(); resolve(); } }, false);
		});
		startReviewSession(review.id);
		const queued = decode((await reader.read()).value!);
		expect(queued).toMatchObject({ type: 'step', step: 'queued', review: { id: review.id, status: 'queued' } });
		expect(queued.review.startedAt).toBeTruthy();
		await terminal;
	} finally { await reader.cancel(); }
});

test('an orchestrator start decision launches once in the same session and retains developer direction', async () => {
	const review = draft();
	// Fail before provider I/O; the transition itself must be a real pipeline launch.
	db.repos.delete(review.repoId);
	globalThis.fetch = (async () => Response.json({ choices: [{ message: { content: JSON.stringify({ message: 'I’ll begin the review, focusing on missing tests.', action: 'start_review' }) } }] })) as unknown as typeof fetch;
	const terminal = new Promise<void>((resolve) => {
		const off = subscribeReview(review.id, event => { if (event.type === 'error' && !event.step) { off(); resolve(); } }, false);
	});
	startReviewChat(review.id, ORCHESTRATOR_ID, 'Start the review and focus on missing tests.');
	await terminal;
	const stored = db.reviews.get(review.id)!;
	expect(stored.status).toBe('failed');
	expect(stored.summary).toBe('repo not found');
	expect(stored.startedAt).toBeTruthy();
	expect(discussionContext(review.id)).toContain('Start the review and focus on missing tests.');
	expect(reviewProgress.get(review.id)?.messages?.at(-1)?.text).toBe('I’ll begin the review, focusing on missing tests.');
	expect(() => startReviewSession(review.id)).toThrow('already started');
});

test('invalid draft decisions do not launch analysis or expose raw JSON in chat', async () => {
	const review = draft();
	globalThis.fetch = (async () => Response.json({ choices: [{ message: { content: '{"action":"invented_action"}' } }] })) as unknown as typeof fetch;
	const done = settled(review.id);
	startReviewChat(review.id, ORCHESTRATOR_ID, 'Start reviewing');
	await done;
	expect(db.reviews.get(review.id)?.status).toBe('draft');
	expect(reviewProgress.get(review.id)?.messages?.at(-1)).toMatchObject({ status: 'error' });
	expect(reviewProgress.get(review.id)?.messages?.at(-1)?.text).not.toContain('invented_action');
});

test('stopping an initial prompt leaves the session unstarted and retryable', async () => {
	const review = draft();
	globalThis.fetch = (async (_url, init) => {
		await new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
		return new Response();
	}) as typeof fetch;
	const done = settled(review.id);
	startReviewChat(review.id, ORCHESTRATOR_ID, 'Start the review');
	await new Promise(resolve => setTimeout(resolve, 10));
	stopReviewChat(review.id, ORCHESTRATOR_ID);
	await done;
	expect(db.reviews.get(review.id)?.status).toBe('draft');
	expect(reviewProgress.get(review.id)?.messages?.at(-1)).toMatchObject({ status: 'error', text: 'Reply stopped.' });
});

test('code questions during review persist their selection and feed subsequent review turns', async () => {
	const review = draft();
	db.reviews.set({ ...review, status: 'running' });
	const context = {
		file: 'src/late-in-diff.ts', startLine: 120, endLine: 122, side: 'old' as const,
		quote: 'return cache.get(tenant);', diffContext: '-return cache.get(tenant);\n+return cache.get(key);'
	};
	let prompt = '';
	globalThis.fetch = (async (_url, init) => {
		prompt = String(init?.body);
		return Response.json({ choices: [{ message: { content: 'The deleted code used the tenant as its key.' } }] });
	}) as typeof fetch;
	const done = settled(review.id);
	const response = await app.request(`/api/reviews/${review.id}/chat`, {
		method: 'POST', headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ assignmentId: ORCHESTRATOR_ID, text: 'Why did this change?', codeContext: context })
	});
	expect(response.status).toBe(202);
	expect(await response.json()).toMatchObject({ text: 'Why did this change?', codeContext: context });
	await done;
	expect(db.reviews.get(review.id)?.status).toBe('running');
	expect(reviewProgress.get(review.id)?.messages?.find(message => message.from === 'user')?.codeContext).toEqual(context);
	expect(prompt).toContain('src/late-in-diff.ts:120-122 (old side)');
	expect(prompt).toContain('return cache.get(tenant)');
	expect(discussionContext(review.id)).toContain('Why did this change?');
	expect(discussionContext(review.id)).toContain('The deleted code used the tenant');
});

test('code selection validation rejects reversed ranges and oversized excerpts without starting a reply', async () => {
	const review = draft();
	const base = { file: 'src/code.ts', startLine: 10, endLine: 12, side: 'new', quote: 'code' };
	for (const codeContext of [{ ...base, endLine: 9 }, { ...base, quote: 'x'.repeat(4001) }, { ...base, side: 'invalid' }]) {
		const response = await app.request(`/api/reviews/${review.id}/chat`, {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ assignmentId: ORCHESTRATOR_ID, text: 'Explain this', codeContext })
		});
		expect(response.status).toBe(400);
	}
	expect(reviewProgress.get(review.id)?.messages ?? []).toEqual([]);
});
