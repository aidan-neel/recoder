import { afterEach, expect, test } from 'bun:test';
import { INTERRUPTED, newChat, newTurn, WRITER_STALE_MS } from '../../src/repo-chat/chat-record';
import { loadChat, openChat, recoverRepoChats, requestStop, saveReply } from '../../src/repo-chat/chat-turns';
import { closeStore, db } from '../../src/store';

afterEach(async () => {
	await db.repoChats.clear();
});

/** A saved chat whose reply is open with `text` so far. */
async function openReply(text: string) {
	const at = new Date().toISOString();
	const turn = newTurn('How is the cart total computed?', 'lead', at);
	const chat = await openChat(newChat('repo-1', 'Cart totals', at, 'owner'), turn);

	expect(await saveReply(chat.id, { ...turn.reply, text })).toBe('saved');

	return { chat, turn };
}

test('a chat and its partial reply survive the store closing and reopening', async () => {
	const { chat } = await openReply('It sums the lines');

	await closeStore();

	expect(await loadChat(chat.id)).toMatchObject({
		title: 'Cart totals',
		messages: [
			{ from: 'user', text: 'How is the cart total computed?' },
			{ from: 'assistant', text: 'It sums the lines', status: 'streaming' }
		]
	});
});

test('a reply keeps its trail and citations through a save and a reload', async () => {
	const { chat, turn } = await openReply('It sums the lines');
	const at = new Date().toISOString();
	const trail = [{ id: 't', kind: 'thought' as const, title: 'Framing', text: 'Cart totals', startedAt: at }];
	const citations = [{ path: 'src/cart.ts', startLine: 3, snippet: 'sum(lines)' }];

	await saveReply(chat.id, { ...turn.reply, text: 'It sums the lines', status: 'done', trail, citations });
	await closeStore();

	expect((await loadChat(chat.id))?.messages.at(-1)).toMatchObject({ trail, citations });
});

test('a restarted standalone server closes replies left open, keeping their text', async () => {
	const { chat } = await openReply('It sums the lines');

	expect(await recoverRepoChats()).toBe(1);

	const saved = await db.repoChats.get(chat.id);

	expect(saved?.writer).toBeUndefined();

	expect(saved?.messages.at(-1)).toMatchObject({
		status: 'error',
		text: 'It sums the lines',
		failure: { reason: INTERRUPTED }
	});
});

test('a reply whose writer went quiet closes as interrupted, and that writer can no longer save over it', async () => {
	const { chat, turn } = await openReply('It sums');
	const quiet = new Date(Date.now() - WRITER_STALE_MS - 1000).toISOString();

	await db.repoChats.update(chat.id, (current) =>
		current?.writer ? { ...current, writer: { ...current.writer, heartbeatAt: quiet } } : current
	);

	expect((await loadChat(chat.id))?.messages.at(-1)).toMatchObject({
		status: 'error',
		failure: { reason: INTERRUPTED }
	});

	expect(await saveReply(chat.id, { ...turn.reply, text: 'It sums the lines', status: 'done' })).toBe('lost');
	expect((await db.repoChats.get(chat.id))?.messages.at(-1)?.text).toBe('It sums');
});

test('a stop asked for on the record reaches the writer at its next save, wherever it runs', async () => {
	const { chat, turn } = await openReply('It sums');

	expect(await requestStop(chat.id, 'an-earlier-reply')).toBe(false);
	expect(await saveReply(chat.id, { ...turn.reply, text: 'It' })).toBe('saved');
	expect(await requestStop(chat.id, turn.reply.id)).toBe(true);
	expect(await saveReply(chat.id, { ...turn.reply, text: 'It sums the' })).toBe('stop');
	expect(await saveReply(chat.id, { ...turn.reply, text: 'It sums the', status: 'done', stopped: true })).toBe('saved');
	expect(await requestStop(chat.id, turn.reply.id)).toBe(false);
});
