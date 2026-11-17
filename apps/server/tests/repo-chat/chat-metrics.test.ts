import { afterEach, expect, test } from 'bun:test';

import { trackTokenCall, withUsageMetrics } from '../../src/models/metrics';
import { newChat, newTurn } from '../../src/repo-chat/chat-record';
import { openChat } from '../../src/repo-chat/chat-turns';
import chats from '../../src/routes/chats';
import { db, modelCalls, reviewMetrics } from '../../src/store';

afterEach(async () => {
	await db.repoChats.clear();
	await reviewMetrics.clear();
	await modelCalls.clear();
});

test('GET /:id/metrics answers 404 for a missing chat, null before calls, and aggregated metrics after calls', async () => {
	const missing = await chats.request('/missing-chat/metrics');

	expect(missing.status).toBe(404);

	const at = new Date().toISOString();
	const chat = await openChat(newChat('repo-1', 'Rate limits', at, 'owner'), newTurn('Explain take()', 'lead', at));
	const empty = await chats.request(`/${chat.id}/metrics`);

	expect(empty.status).toBe(200);
	expect(empty.headers.get('Cache-Control')).toBe('no-store');
	expect(await empty.json()).toBeNull();

	await withUsageMetrics(chat.id, 'discussion', async () => {
		const call = trackTokenCall('claude-sonnet-4-6', 'claude-code');

		call.usage({
			inputTokens: 1200,
			outputTokens: 340,
			totalTokens: 1540,
			cachedInputTokens: 800,
			cacheWriteInputTokens: 100,
			reasoningOutputTokens: null
		});

		call.complete();
		await call.flush();
	});

	const loaded = await chats.request(`/${chat.id}/metrics`);

	expect(loaded.status).toBe(200);

	expect(await loaded.json()).toMatchObject({
		reviewId: chat.id,
		pipelineTracked: false,
		total: {
			calls: 1,
			pendingCalls: 0,
			failedCalls: 0,
			usage: {
				inputTokens: 1200,
				outputTokens: 340,
				totalTokens: 1540,
				cachedInputTokens: 800,
				cacheWriteInputTokens: 100
			}
		},
		models: [{ model: 'claude-sonnet-4-6', provider: 'claude-code', calls: 1 }]
	});
});
