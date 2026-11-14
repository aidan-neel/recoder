import { expect, test } from 'bun:test';
import type { RepoChatMessage } from '@recoder/shared';
import { parseThoughts, TrailRecorder } from '../../src/repo-chat/chat-trail';

function reply(): RepoChatMessage {
	return { id: 'r', from: 'assistant', text: '', at: new Date().toISOString(), status: 'streaming' };
}

test('reasoning with bold headings on their own lines splits into titled thoughts', () => {
	expect(parseThoughts('**Framing**\nThe question is about caps.\n\n**Checking the math**\nIt never clamps.')).toEqual([
		{ title: 'Framing', text: 'The question is about caps.' },
		{ title: 'Checking the math', text: 'It never clamps.' }
	]);
});

test('reasoning with no headings is one untitled thought, and a bold phrase inside a sentence is not a heading', () => {
	expect(parseThoughts('Look at **take** first.\nThen the test.')).toEqual([
		{ title: '', text: 'Look at **take** first.\nThen the test.' }
	]);
});

test('streamed reasoning grows its last thought and ends the earlier ones', () => {
	const message = reply();
	const recorder = new TrailRecorder(message, () => undefined);

	recorder.addReasoning('**First**\nOne');
	recorder.addReasoning('.\n\n**Second**\nTw');

	expect(message.trail).toMatchObject([
		{ id: 'thought-0', title: 'First', text: 'One.', endedAt: expect.any(String) },
		{ id: 'thought-1', title: 'Second', text: 'Tw' }
	]);

	expect(message.trail?.[1].endedAt).toBeUndefined();

	recorder.endThinking();

	expect(message.trail?.[1].endedAt).toEqual(expect.any(String));
});

test('the read step lists the files read, and vanishes when none were', () => {
	const message = reply();
	const recorder = new TrailRecorder(message, () => undefined);

	recorder.startReading();
	recorder.finishReading(['README.md', 'src/a.ts']);

	expect(message.trail).toMatchObject([
		{ kind: 'read', status: 'done', files: [{ path: 'README.md' }, { path: 'src/a.ts' }] }
	]);

	const empty = reply();
	const quiet = new TrailRecorder(empty, () => undefined);

	quiet.startReading();
	quiet.finishReading([]);

	expect(empty.trail).toEqual([]);
});
