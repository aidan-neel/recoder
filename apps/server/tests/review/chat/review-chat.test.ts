import { afterEach, expect, test } from 'bun:test';
import { ORCHESTRATOR_ID, emptyReviewProgress } from '@recoder/shared';
import { db, recoverStaleReviews, reviewProgress } from '../../../src/store';
import { app } from '../../../src/app';
import { rerunReviewSession } from '../../../src/commands/rerun';
import { discussionContext, startReviewChat, stopReviewChat } from '../../../src/review/chat/review-chat';
import { getStoredSettings, setReviewOverrides } from '../../../src/review/session/review-settings';
import { subscribeReview, clearReviewEvents, reviewEventBuffer } from '../../../src/review/session/events';
import { applyProgressMessage } from '../../../../web/src/lib/review/review-progress-state';
import { fetchUntilAborted } from '../../helpers/fetch';
import { testReview } from '../../helpers/review';

const originalFetch = globalThis.fetch;
const originalSettings = getStoredSettings();
const ids: string[] = [];

afterEach(() => {
	globalThis.fetch = originalFetch;
	setReviewOverrides(originalSettings);

	for (const id of ids.splice(0)) {
		db.reviews.delete(id);
		clearReviewEvents(id);
	}
});

function setup() {
	const id = crypto.randomUUID();

	ids.push(id);

	db.reviews.set(testReview({ id, headSha: 'abc', summary: 'Done', prTitle: 'Review' }));

	reviewProgress.set({
		...emptyReviewProgress(id),
		assignments: [
			{ id: 'subagent-1', role: 'subagent', title: 'Auth checks', status: 'done', reason: 'Auth changed', scope: [] }
		]
	});

	setReviewOverrides({
		baseUrl: 'http://model.test/v1',
		apiKey: 'test',
		models: [
			{ id: 'lead', label: 'Lead', model: 'lead' },
			{ id: 'worker', label: 'Worker', model: 'worker' }
		],
		orchestratorModelId: 'lead',
		specialistModelId: 'worker'
	});

	return id;
}

function settled(id: string, assignmentId: string) {
	return new Promise<void>((resolve) => {
		const off = subscribeReview(
			id,
			(event) => {
				const message = event.data?.chatMessage as { from: string; status: string; assignmentId: string } | undefined;

				if (message?.from === 'assistant' && message.assignmentId === assignmentId && message.status !== 'streaming') {
					off();
					resolve();
				}
			},
			false
		);
	});
}

test('server restart settles interrupted replies even on completed reviews', () => {
	const id = setup();
	const progress = reviewProgress.get(id)!;

	reviewProgress.set({
		...progress,
		messages: [
			{
				id: 'orphan',
				assignmentId: ORCHESTRATOR_ID,
				from: 'assistant',
				text: 'Partial reply',
				status: 'streaming',
				at: new Date().toISOString(),
				discussion: true
			}
		]
	});

	recoverStaleReviews();
	expect(db.reviews.get(id)?.status).toBe('passed');
	expect(reviewProgress.get(id)?.messages?.[0]).toMatchObject({ status: 'error' });
	expect(reviewProgress.get(id)?.messages?.[0].text).toContain('server restart');
});

test('subagent chat runs on the second model, streams, persists and is visible in subsequent orchestrator requests', async () => {
	const id = setup();
	const requests: Array<{ model: string; messages: { content: string }[] }> = [];

	globalThis.fetch = (async (_url, init) => {
		requests.push(JSON.parse(init?.body as string));

		return Response.json({ choices: [{ message: { content: 'The caller checks the token.' } }] });
	}) as typeof fetch;

	const done = settled(id, 'subagent-1');

	startReviewChat(id, 'subagent-1', 'Is the caller protected?');
	await done;
	expect(requests[0].model).toBe('worker');
	expect(discussionContext(id)).toContain('Is the caller protected?');
	expect(discussionContext(id)).toContain('The caller checks the token.');
	expect(discussionContext(id, 'unrelated-subagent')).toBe('');

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

	globalThis.fetch = fetchUntilAborted;

	const bad = await app.request(`/api/reviews/${id}/chat`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ assignmentId: 'missing', text: 'Hello' })
	});

	expect(bad.status).toBe(404);

	const done = settled(id, ORCHESTRATOR_ID);

	startReviewChat(id, ORCHESTRATOR_ID, 'Explain');
	expect(() => startReviewChat(id, ORCHESTRATOR_ID, 'Again')).toThrow('still replying');
	await new Promise((resolve) => setTimeout(resolve, 10));
	stopReviewChat(id, ORCHESTRATOR_ID);
	await done;
	expect(reviewProgress.get(id)?.messages?.at(-1)).toMatchObject({ status: 'error', text: 'Reply stopped.' });
});

test('a reply ending in a recoder-review block reruns the finished review and keeps only the conversation', async () => {
	const id = setup();
	const startedAt = new Date(Date.now() - 60_000).toISOString();

	db.reviews.set({ ...db.reviews.get(id)!, startedAt });

	reviewProgress.set({
		...reviewProgress.get(id)!,
		reasoning: [
			{ id: 'old', assignmentId: 'unit-1', role: 'reviewer', model: 'worker', text: 'Old run.', at: startedAt }
		]
	});

	globalThis.fetch = (async () =>
		Response.json({
			choices: [{ message: { content: 'Starting a new review with subagents.\n\n```recoder-review\n{}\n```' } }]
		})) as unknown as typeof fetch;

	const events: Array<{ step?: string; data?: Record<string, unknown> }> = [];
	const off = subscribeReview(id, (event) => events.push(event), false);
	const done = settled(id, ORCHESTRATOR_ID);

	startReviewChat(id, ORCHESTRATOR_ID, 'Try another review, and use subagents this time.');
	await done;
	off();

	const progress = reviewProgress.get(id)!;

	expect(progress.messages?.at(-1)).toMatchObject({ status: 'done', text: 'Starting a new review with subagents.' });
	expect(progress.messages?.every((message) => message.discussion)).toBe(true);
	expect(progress.reasoning?.some((entry) => entry.id === 'old')).toBe(false);
	expect(events.some((event) => event.step === 'queued' && event.data?.reset === true)).toBe(true);
	expect(Date.parse(db.reviews.get(id)!.startedAt!)).toBeGreaterThan(Date.parse(startedAt));
});

test('a review that is already running cannot be rerun', () => {
	const id = setup();

	db.reviews.set({ ...db.reviews.get(id)!, status: 'running' });
	expect(() => rerunReviewSession(id)).toThrow('already running');
});
