import { describe, expect, test } from 'bun:test';
import type { Conversation } from '@recoder/shared';

import { dockHeads, QUIET_MS } from '../../src/lib/messages/dock-heads';

const NOW = Date.UTC(2026, 10, 23, 12);
const HOUR = 60 * 60 * 1000;

/** A conversation whose newest message is `ago` before now, with `unread` messages waiting. */
function conversation(id: string, ago: number, unread = 0): Conversation {
	const at = new Date(NOW - ago).toISOString();

	return {
		id,
		with: { provider: 'github', host: null, login: id, accountId: `a-${id}`, name: null, avatarUrl: null },
		open: true,
		lastMessage: {
			id: `${id}-1`,
			conversationId: id,
			sequence: 1,
			authorId: `a-${id}`,
			clientId: `${id}-k1`,
			body: 'hello',
			attachments: [],
			createdAt: at
		},
		lastSequence: 1,
		readSequence: unread > 0 ? 0 : 1,
		theirReadSequence: 0,
		unread,
		createdAt: at,
		updatedAt: at
	};
}

const ids = (list: Conversation[]) => list.map((item) => item.id);

describe('dockHeads', () => {
	test('stacks at most four recent conversations, newest activity first', () => {
		const list = ['a', 'b', 'c', 'd', 'e'].map((id, index) => conversation(id, (index + 1) * HOUR));

		expect(ids(dockHeads(list, {}, null, NOW))).toEqual(['a', 'b', 'c', 'd']);
	});

	test('leaves out a quiet conversation unless it has unread messages or was kept since', () => {
		const list = [
			conversation('quiet', QUIET_MS + HOUR),
			conversation('waiting', QUIET_MS * 2, 1),
			conversation('kept', QUIET_MS * 3)
		];

		expect(ids(dockHeads(list, { kept: NOW - HOUR }, null, NOW))).toEqual(['kept', 'waiting']);
	});

	test('keeps the open conversation in the last place when four newer ones would push it off', () => {
		const list = ['a', 'b', 'c', 'd', 'open'].map((id, index) => conversation(id, (index + 1) * HOUR));

		expect(ids(dockHeads(list, {}, 'open', NOW))).toEqual(['a', 'b', 'c', 'open']);
	});
});
