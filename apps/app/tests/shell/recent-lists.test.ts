import { describe, expect, test } from 'bun:test';
import { REVIEW_CANCELLED, type RepoChatSummary } from '@recoder/shared';

import { recentChats } from '../../src/lib/shell/recent-chats';
import { recentReviews } from '../../src/lib/shell/recent-reviews';
import { AUTO_SETTLE_MS, isChatSettled, isReviewSettled, sidebarLists } from '../../src/lib/shell/settle';
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

	test('an open pull request review never auto-settles on a timer', () => {
		const openReview = review({ id: 'open-old', prNumber: 1, pullState: 'open', updatedAt: CHANGED });

		const rows = sidebarLists(
			{ ...recentReviews([openReview], REPOS, ''), chats: [] },
			{},
			changed + AUTO_SETTLE_MS * 100
		);

		expect(rows.recent.map((row) => row.reviewId)).toEqual(['open-old']);
		expect(rows.settled).toEqual([]);
	});

	test('an open review settled by hand comes back once it changes again', () => {
		const marks = { a: { settled: true, at: changed + 1000 } };

		expect(isReviewSettled('a', CHANGED, false, marks)).toBe(true);
		expect(isReviewSettled('a', '2026-03-01T12:00:05Z', false, marks)).toBe(false);
	});

	test('a merged or closed review settles by default and returns to Reviews when unsettled', () => {
		const merged = review({ id: 'done', prNumber: 9, pullState: 'merged', updatedAt: CHANGED });
		const unsettledAt = changed + 60_000;
		const marks = { done: { settled: false, at: unsettledAt } };

		const settledByDefault = sidebarLists({ ...recentReviews([merged], REPOS, ''), chats: [] }, {}, unsettledAt);
		const broughtBack = sidebarLists({ ...recentReviews([merged], REPOS, ''), chats: [] }, marks, unsettledAt);

		expect(settledByDefault.recent).toEqual([]);
		expect(settledByDefault.settled.map((entry) => entry.kind === 'review' && entry.row.reviewId)).toEqual(['done']);
		expect(broughtBack.recent.map((row) => row.reviewId)).toEqual(['done']);
		expect(broughtBack.settled).toEqual([]);
	});

	test('unsettling an older ended review brings it into the visible recent list ahead of the limit', () => {
		const active = Array.from({ length: 8 }, (_, index) =>
			review({ id: `open-${index}`, prNumber: index, updatedAt: `2026-03-${String(index + 10).padStart(2, '0')}` })
		);

		const oldMerged = review({ id: 'old-merged', prNumber: 99, pullState: 'merged', updatedAt: '2026-01-01' });
		const now = Date.parse('2026-03-20T00:00:00Z');
		const marks = { 'old-merged': { settled: false, at: now } };

		const rows = sidebarLists({ ...recentReviews([...active, oldMerged], REPOS, ''), chats: [] }, marks, now);

		expect(rows.recent[0]?.reviewId).toBe('old-merged');
		expect(rows.recent).toHaveLength(8);
		expect(rows.settled).toEqual([]);
	});

	test('a chat settles on its own after three quiet hours and rests again when unsettled', () => {
		expect(isChatSettled('c', CHANGED, {}, changed + AUTO_SETTLE_MS - 1)).toBe(false);
		expect(isChatSettled('c', CHANGED, {}, changed + AUTO_SETTLE_MS)).toBe(true);

		const back = changed + AUTO_SETTLE_MS * 2;
		const marks = { c: { settled: false, at: back } };

		expect(isChatSettled('c', CHANGED, marks, back + AUTO_SETTLE_MS - 1)).toBe(false);
		expect(isChatSettled('c', CHANGED, marks, back + AUTO_SETTLE_MS)).toBe(true);
	});
});
