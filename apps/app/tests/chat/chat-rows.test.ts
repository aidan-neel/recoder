import { describe, expect, test } from 'bun:test';
import type { RepoChatMessage } from '@recoder/shared';

import { chatRows, isReplying, type Outgoing } from '../../src/lib/chat/chat-rows';

const AT = '2026-11-13T10:00:00.000Z';

function message(id: string, from: RepoChatMessage['from'], text: string, extra: Partial<RepoChatMessage> = {}) {
	return { id, from, text, at: AT, status: 'done', ...extra } satisfies RepoChatMessage;
}

function outgoing(text: string, extra: Partial<Outgoing> = {}): Outgoing {
	return { key: `local-${text}`, text, state: 'pending', after: 0, ...extra };
}

const pullHref = (prNumber: number) => `/pulls/r/${prNumber}`;

describe('chatRows', () => {
	test('a pending message shows once the events carry its copy before the send answers', () => {
		const sent = outgoing('Where is the limiter?', { after: 2 });

		const messages = [
			message('m1', 'user', 'Where is the limiter?'),
			message('m2', 'assistant', 'In src/limit.ts.'),
			message('m3', 'user', 'Where is the limiter?'),
			message('m4', 'assistant', '', { status: 'streaming' })
		];

		const rows = chatRows(messages, [sent], pullHref);

		expect(rows.map((row) => row.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
	});

	test('a pending message stays until its copy arrives after the messages it was sent after', () => {
		const sent = outgoing('Where is the limiter?', { after: 2 });
		const messages = [message('m1', 'user', 'Where is the limiter?'), message('m2', 'assistant', 'In src/limit.ts.')];

		const rows = chatRows(messages, [sent], pullHref);

		expect(rows.map((row) => row.id)).toEqual(['m1', 'm2', sent.key]);
	});

	test('a refused message stays in the thread with its reason even when the same text was sent before', () => {
		const refused = outgoing('Again?', { state: 'failed', error: 'Recoder is still replying.' });
		const messages = [message('m1', 'user', 'Again?')];

		const rows = chatRows(messages, [refused], pullHref);

		expect(rows.at(-1)).toMatchObject({ id: refused.key, state: 'failed', error: 'Recoder is still replying.' });
	});

	test('a reply that started a review links to the pull request', () => {
		const reply = message('m2', 'assistant', 'Started a review of #42.', { review: { id: 'rv', prNumber: 42 } });

		const [row] = chatRows([reply], [], pullHref);

		expect(row.text).toContain('[Open #42](/pulls/r/42)');
	});
});

describe('isReplying', () => {
	test('stays true from sending until the reply that followed the message has finished', () => {
		const sent = outgoing('Hi', { state: 'sent', serverId: 'm1' });
		const question = message('m1', 'user', 'Hi');

		expect(isReplying([], [outgoing('Hi')])).toBe(true);
		expect(isReplying([], [sent])).toBe(true);
		expect(isReplying([question, message('m2', 'assistant', 'Hel', { status: 'streaming' })], [sent])).toBe(true);
		expect(isReplying([question, message('m2', 'assistant', 'Hello')], [sent])).toBe(false);
	});

	test('is false after a refused message', () => {
		expect(isReplying([], [outgoing('Hi', { state: 'failed', error: 'No.' })])).toBe(false);
	});
});
