import { describe, expect, test } from 'bun:test';
import { REVIEW_CANCELLED, type RepoChatSummary } from '@recoder/shared';

import { recentChats } from '../../src/lib/shell/recent-chats';
import { recentReviews } from '../../src/lib/shell/recent-reviews';
import { AUTO_SETTLE_MS, isSettled, sidebarLists } from '../../src/lib/shell/settle';
import { review, tracked } from '../fixtures';

const REPOS = [tracked('r1', 'acme/api')];

function chat(id: string, repoId: string): RepoChatSummary {
	return { id, repoId, title: `Chat ${id}`, createdAt: '', updatedAt: '' };
}

describe('the sidebar lists', () => {
	test('a review a person cancelled is its own state, not a failure', () => {
		const reviews = [
			review({ id: 'failed', prNumber: 1, status: 'failed', summary: 'Checkout timed out.' }),
			review({ id: 'cancelled', prNumber: 2, status: 'failed', summary: REVIEW_CANCELLED })
		];

		const { open } = recentReviews(reviews, REPOS, '');

		expect(Object.fromEntries(open.map((row) => [row.reviewId, row.state]))).toEqual({
			failed: 'failed',
			cancelled: 'cancelled'
		});
	});

	test('reviews of a removed repo are left out instead of showing its id', () => {
		const reviews = [review({ id: 'kept' }), review({ id: 'orphan', repoId: 'removed', prNumber: 9 })];

		const { open } = recentReviews(reviews, REPOS, '');

		expect(open.map((row) => [row.reviewId, row.repoName])).toEqual([['kept', 'api']]);
	});

	test('reviews of merged and closed pull requests go to ended, not open', () => {
		const reviews = [
			review({ id: 'open', prNumber: 1, pullState: 'open' }),
			review({ id: 'unknown', prNumber: 2 }),
			review({ id: 'merged', prNumber: 3, pullState: 'merged' }),
			review({ id: 'closed', prNumber: 4, pullState: 'closed' })
		];

		const { open, ended } = recentReviews(reviews, REPOS, '');

		expect(open.map((row) => row.reviewId).sort()).toEqual(['open', 'unknown']);

		expect(ended.map((row) => [row.reviewId, row.outcome]).sort()).toEqual([
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

		const rows = sidebarLists(
			{ ...recentReviews([...active, ...settled], REPOS, ''), chats: [] },
			{},
			Date.parse('2026-01-01')
		);

		const ids = rows.settled.map((entry) => (entry.kind === 'review' ? entry.row.reviewId : entry.row.chatId));

		expect(rows.recent).toHaveLength(8);
		expect(rows.settled).toHaveLength(12);
		expect(ids[0]).toBe('done-11');
		expect(ids[11]).toBe('done-0');
	});

	test('chats in a removed repo are left out', () => {
		const rows = recentChats([chat('kept', 'r1'), chat('orphan', 'removed')], REPOS, '');

		expect(rows.map((row) => row.chatId)).toEqual(['kept']);
	});
});

describe('settling a sidebar row', () => {
	const CHANGED = '2026-03-01T12:00:00Z';
	const changed = Date.parse(CHANGED);

	test('a row settles on its own after three quiet hours', () => {
		expect(isSettled('a', CHANGED, {}, changed + AUTO_SETTLE_MS - 1)).toBe(false);
		expect(isSettled('a', CHANGED, {}, changed + AUTO_SETTLE_MS)).toBe(true);
	});

	test('a running review never settles on its own', () => {
		expect(isSettled('a', CHANGED, {}, changed + AUTO_SETTLE_MS * 10, true)).toBe(false);
	});

	test('a row settled by hand comes back once it changes again', () => {
		const marks = { a: { settled: true, at: changed + 1000 } };

		expect(isSettled('a', CHANGED, marks, changed + 2000)).toBe(true);
		expect(isSettled('a', '2026-03-01T12:00:05Z', marks, changed + 6000)).toBe(false);
	});

	test('an unsettled row rests three hours from the moment it was brought back', () => {
		const back = changed + AUTO_SETTLE_MS * 2;
		const marks = { a: { settled: false, at: back } };

		expect(isSettled('a', CHANGED, marks, back + AUTO_SETTLE_MS - 1)).toBe(false);
		expect(isSettled('a', CHANGED, marks, back + AUTO_SETTLE_MS)).toBe(true);
	});
});
