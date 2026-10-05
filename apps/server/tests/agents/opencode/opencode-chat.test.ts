import { describe, expect, test } from 'bun:test';
import { ChatConversation } from '../../../src/models/llm/conversation';
import type { ChatOptions } from '../../../src/models/llm/types';
import { useFakeOpenCode } from '../../helpers/fake-opencode';
import { ask, calls, cancelledChat, expectProviderStatuses, streamedUsage } from '../../helpers/opencode-chat';

const start = useFakeOpenCode();

/** The call after 'hi' was answered with `reply`: the transcript so far plus one new user turn. */
function nextTurn(conversation: ChatConversation, reply: string, content: string): ChatOptions {
	return ask('', {
		conversation,
		messages: [
			{ role: 'user', content: 'hi' },
			{ role: 'assistant', content: reply },
			{ role: 'user', content }
		]
	});
}

describe('OpenCode chat', () => {
	test('streams only its own session text and reasoning, in order, and reports usage', async () => {
		expect(await streamedUsage(await start())).toEqual({
			inputTokens: 11,
			outputTokens: 6,
			totalTokens: 17,
			cachedInputTokens: 1,
			cacheWriteInputTokens: 0,
			reasoningOutputTokens: 2
		});
	});

	test('runs with every tool and permission off, then deletes the session', async () => {
		const target = await start();

		await target.complete(ask('hi'));

		const log = await calls(target);

		expect(log[0]).toMatchObject({
			method: 'POST',
			path: '/session',
			body: { permission: [{ permission: '*', pattern: '*', action: 'deny' }] }
		});

		expect(log[1].body).toMatchObject({ model: { providerID: 'openai', modelID: 'm' }, tools: { '*': false } });
		expect(log.at(-1)).toMatchObject({ method: 'DELETE', path: '/session/ses_1' });
	});

	test('sends an effort only when the model offers it as a variant', async () => {
		const target = await start();

		await target.complete(ask('hi', { reasoningEffort: 'high' }));
		await target.complete(ask('hi', { reasoningEffort: 'low' }));

		const messages = (await calls(target)).filter((c) => c.path.endsWith('/message'));

		expect(messages[0].body?.variant).toBe('high');
		expect(messages[1].body).not.toHaveProperty('variant');
	});

	test.each([
		['refuses forced tool choice', 'auto-only'],
		['fills the schema with an empty object', 'empty-structured']
	])('a model that %s gets plain JSON mode, now and on later calls', async (_, prompt) => {
		const target = await start();
		const schema = { name: 'r', schema: { type: 'object' } };

		expect(JSON.parse(await target.complete(ask(prompt, { jsonSchema: schema })))).toEqual({ ok: true });
		expect(JSON.parse(await target.complete(ask(prompt, { jsonSchema: schema })))).toEqual({ ok: true });

		const messages = (await calls(target)).filter((c) => c.path.endsWith('/message'));

		expect(messages.map((m) => 'format' in (m.body ?? {}))).toEqual([true, false, false]);
		expect(messages[1].body?.system).toContain('JSON');
	});

	test('returns the structured object as JSON when a schema was sent', async () => {
		const target = await start();
		const schema = { name: 'r', schema: { type: 'object' } };

		expect(JSON.parse(await target.complete(ask('structured', { jsonSchema: schema })))).toEqual({ ok: true });
	});

	test("keeps the provider's status on a failed reply", async () => {
		await expectProviderStatuses(await start());
	});

	test('a cancelled call aborts and deletes its session', async () => {
		const target = await start();

		expect(await cancelledChat(target, '/session/ses_1/message')).toMatchObject({
			message: 'Model request cancelled'
		});

		const paths = (await calls(target)).map((c) => `${c.method} ${c.path}`);

		expect(paths).toContain('POST /session/ses_1/abort');
		expect(paths).toContain('DELETE /session/ses_1');
	});

	test('calls of one conversation share a session and send only the added turns', async () => {
		const target = await start();
		const conversation = new ChatConversation();
		const first = await target.complete(ask('hi', { conversation }));

		await target.complete(nextTurn(conversation, first, 'tool results'));
		await conversation.close();

		const log = await calls(target);
		const sent = log.filter((c) => c.method === 'POST' && c.path.endsWith('/message'));

		expect(sent.map((c) => c.path)).toEqual(['/session/ses_1/message', '/session/ses_1/message']);
		expect(sent[1].body?.parts).toEqual([{ type: 'text', text: 'tool results' }]);
		expect(log.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/session/ses_1']);
	});

	test("a failed call's messages are removed, so the retry continues the same session", async () => {
		const target = await start();
		const conversation = new ChatConversation();
		const first = await target.complete(ask('hi', { conversation }));

		await expect(target.complete(nextTurn(conversation, first, 'denied'))).rejects.toMatchObject({ status: 403 });
		await target.complete(nextTurn(conversation, first, 'again'));

		const log = await calls(target);

		expect(log.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual([
			'/session/ses_1/message/msg_4',
			'/session/ses_1/message/msg_3'
		]);

		expect(log.at(-1)).toMatchObject({ path: '/session/ses_1/message', body: { parts: [{ text: 'again' }] } });
		await conversation.close();
	});

	test('a transcript the session does not continue starts a new session with all of it', async () => {
		const target = await start();
		const conversation = new ChatConversation();

		await target.complete(ask('hi', { conversation }));

		await target.complete(nextTurn(conversation, 'a reply the session never gave', 'next'));
		await conversation.close();

		const log = await calls(target);
		const sent = log.filter((c) => c.method === 'POST' && c.path.endsWith('/message'));

		expect(sent[1].path).toBe('/session/ses_2/message');
		expect(JSON.stringify(sent[1].body?.parts)).toContain('Assistant:\\na reply the session never gave');
		expect(log.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/session/ses_1', '/session/ses_2']);
	});
});
