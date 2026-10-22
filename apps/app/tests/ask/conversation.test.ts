import { describe, expect, test } from 'bun:test';
import type { ReviewChatMessage } from '@recoder/shared';

import { conversationRows, retryFor, type Outgoing } from '../../src/lib/ask/conversation';

function message(id: string, from: ReviewChatMessage['from'], text: string): ReviewChatMessage {
	return { id, assignmentId: '__pipeline', from, text, at: '2026-10-17T10:00:00.000Z', status: 'done' };
}

function shape(rows: ReturnType<typeof conversationRows>) {
	return rows.map((row) => [row.kind, row.key]);
}

describe('conversationRows', () => {
	test('the stream’s copy of a sent message takes over its row, so it shows once and keeps its key', () => {
		const sent: Outgoing = {
			key: 'out-1',
			text: 'Which reviewer is slowest?',
			state: 'sent',
			after: 1,
			serverId: 'srv-1'
		};

		const before = conversationRows([message('a0', 'assistant', 'Hi')], [sent]);

		const after = conversationRows(
			[message('a0', 'assistant', 'Hi'), message('srv-1', 'user', 'Which reviewer is slowest?')],
			[sent]
		);

		expect(shape(before)).toEqual([
			['message', 'a0'],
			['outgoing', 'out-1']
		]);

		expect(shape(after)).toEqual([
			['message', 'a0'],
			['message', 'out-1']
		]);
	});

	test('a copy that arrives before the send returns shows once, and an earlier same message is not taken for it', () => {
		const pending: Outgoing = { key: 'out-2', text: 'Again?', state: 'pending', after: 2 };

		const rows = conversationRows(
			[message('u1', 'user', 'Again?'), message('a1', 'assistant', 'Yes.'), message('u2', 'user', 'Again?')],
			[pending]
		);

		expect(shape(rows)).toEqual([
			['message', 'u1'],
			['message', 'a1'],
			['message', 'out-2']
		]);
	});
});

describe('failed replies', () => {
	test('only a failure after the latest question offers to ask it again', () => {
		const failed = (id: string): ReviewChatMessage => ({
			...message(id, 'assistant', ''),
			status: 'error',
			failure: { reason: 'The model call timed out.' }
		});

		const rows = conversationRows(
			[
				message('u1', 'user', 'Focus on the limiter.'),
				failed('a1'),
				message('u2', 'user', 'Focus on the limiter.'),
				message('a2', 'assistant', 'Done.'),
				message('u3', 'user', 'And the cache?'),
				failed('a3')
			],
			[]
		);

		expect(retryFor(rows, 1)).toBeNull();
		expect(retryFor(rows, 5)).toBe('And the cache?');
	});

	test('a failure asked again by a question still on its way offers no Try again', () => {
		const rows = conversationRows(
			[
				message('u1', 'user', 'Why?'),
				{ ...message('a1', 'assistant', ''), status: 'error', failure: { reason: 'Timed out.' } }
			],
			[{ key: 'out-1', text: 'Why?', state: 'pending', after: 2 }]
		);

		expect(retryFor(rows, 1)).toBeNull();
	});
});
