import { describe, expect, test } from 'bun:test';
import type { RepoChatSummary } from '@recoder/shared';

import { recentChats } from '../../src/lib/shell/recent-chats';
import { recentReviews } from '../../src/lib/shell/recent-reviews';
import { review, tracked } from '../fixtures';

const REPOS = [tracked('r1', 'acme/api')];

function chat(id: string, repoId: string): RepoChatSummary {
	return { id, repoId, title: `Chat ${id}`, createdAt: '', updatedAt: '' };
}

describe('the sidebar lists', () => {
	test('reviews of a removed repo are left out instead of showing its id', () => {
		const reviews = [review({ id: 'kept' }), review({ id: 'orphan', repoId: 'removed', prNumber: 9 })];

		const { recent } = recentReviews(reviews, REPOS, '');

		expect(recent.map((row) => [row.reviewId, row.repoName])).toEqual([['kept', 'api']]);
	});

	test('reviews of merged and closed pull requests go to settled, not recent', () => {
		const reviews = [
			review({ id: 'open', prNumber: 1, pullState: 'open' }),
			review({ id: 'unknown', prNumber: 2 }),
			review({ id: 'merged', prNumber: 3, pullState: 'merged' }),
			review({ id: 'closed', prNumber: 4, pullState: 'closed' })
		];

		const { recent, settled } = recentReviews(reviews, REPOS, '');

		expect(recent.map((row) => row.reviewId).sort()).toEqual(['open', 'unknown']);

		expect(settled.map((row) => [row.reviewId, row.outcome]).sort()).toEqual([
			['closed', 'closed'],
			['merged', 'merged']
		]);
	});

	test('settled rows are newest first and the limit of eight counts only recent rows', () => {
		const active = Array.from({ length: 10 }, (_, index) =>
			review({ id: `open-${index}`, prNumber: index, updatedAt: `2026-01-${String(index + 1).padStart(2, '0')}` })
		);

		const settled = Array.from({ length: 12 }, (_, index) =>
			review({
				id: `done-${index}`,
				prNumber: 100 + index,
				pullState: 'merged',
				updatedAt: `2026-02-${String(index + 1).padStart(2, '0')}`
			})
		);

		const rows = recentReviews([...active, ...settled], REPOS, '');

		expect(rows.recent).toHaveLength(8);
		expect(rows.settled).toHaveLength(12);
		expect(rows.settled[0].reviewId).toBe('done-11');
		expect(rows.settled[11].reviewId).toBe('done-0');
	});

	test('chats in a removed repo are left out', () => {
		const rows = recentChats([chat('kept', 'r1'), chat('orphan', 'removed')], REPOS, '');

		expect(rows.map((row) => row.chatId)).toEqual(['kept']);
	});
});
