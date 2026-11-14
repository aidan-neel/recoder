import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { newChat, newTurn } from '../../src/repo-chat/chat-record';
import { openChat, type SaveOutcome } from '../../src/repo-chat/chat-turns';
import { ReplySaver } from '../../src/repo-chat/reply-saver';
import { db } from '../../src/store';

afterEach(async () => {
	mock.restore();
	await db.repoChats.clear();
});

test('saves asked for while one runs collapse into one save of the newest text', async () => {
	const at = new Date().toISOString();
	const turn = newTurn('How is the cart total computed?', 'lead', at);
	const chat = await openChat(newChat('repo-1', 'Cart totals', at, 'owner'), turn);
	const update = db.repoChats.update.bind(db.repoChats);
	const gate = Promise.withResolvers<void>();
	const twoHeard = Promise.withResolvers<void>();
	const heard: SaveOutcome[] = [];

	const saves = spyOn(db.repoChats, 'update').mockImplementationOnce(async (id, mutate) => {
		await gate.promise;

		return update(id, mutate);
	});

	const saver = new ReplySaver(chat.id, (outcome) => {
		heard.push(outcome);
		if (heard.length === 2) twoHeard.resolve();
	});

	for (const text of ['It', 'It sums', 'It sums the', 'It sums the lines']) saver.save({ ...turn.reply, text });

	gate.resolve();
	await twoHeard.promise;

	expect((await db.repoChats.get(chat.id))?.messages.at(-1)?.text).toBe('It sums the lines');

	await saver.close({ ...turn.reply, text: 'It sums the lines', status: 'done' });

	expect(saves).toHaveBeenCalledTimes(3);
	expect(heard).toEqual(['saved', 'saved']);
});
