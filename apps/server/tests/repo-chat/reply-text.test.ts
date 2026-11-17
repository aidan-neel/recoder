import { expect, test } from 'bun:test';
import type { RepoChatMessage } from '@recoder/shared';
import { TrailRecorder } from '../../src/repo-chat/chat-trail';
import { ReplyText } from '../../src/repo-chat/reply-text';

function streaming() {
	const reply: RepoChatMessage = {
		id: 'r',
		from: 'assistant',
		text: '',
		at: new Date().toISOString(),
		status: 'streaming'
	};

	return { reply, text: new ReplyText(reply, new TrailRecorder(reply, () => undefined)) };
}

function notes(reply: RepoChatMessage) {
	return (reply.trail ?? []).filter((step) => step.kind === 'note');
}

test('short words before a tool call stream into one note, never the reply, and the call ends it', () => {
	const { reply, text } = streaming();

	text.write("I'll read the README.", 'a');
	text.write("I'll check the tests.", 'b');

	expect(reply.text).toBe('');
	expect(notes(reply)).toMatchObject([{ text: "I'll read the README.\n\nI'll check the tests." }]);
	expect(notes(reply)[0]?.endedAt).toBeUndefined();

	text.toolCalled();

	expect(notes(reply)).toHaveLength(1);
	expect(notes(reply)[0]?.endedAt).toEqual(expect.any(String));
});

test('words that grow into an answer leave the trail and stream in the reply', () => {
	const { reply, text } = streaming();

	text.write('This pull request', 'a');
	text.write(' adds:\n\n- a cache\n- a retry', 'a');

	expect(notes(reply)).toEqual([]);
	expect(reply.text).toBe('This pull request adds:\n\n- a cache\n- a retry');
});

test('short words after the last tool call become the answer when the run ends', () => {
	const { reply, text } = streaming();

	text.write("I'll read it.", 'a');
	text.toolCalled();
	text.write('It is a cache.', 'b');
	text.finish();

	expect(reply.text).toBe('It is a cache.');
	expect(notes(reply)).toMatchObject([{ text: "I'll read it." }]);
});
