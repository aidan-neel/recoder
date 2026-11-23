import { describe, expect, test } from 'bun:test';
import { REVIEW_CANCELLED, type ReviewListItem } from '@recoder/shared';

import { needsReview, rowStatus, shortRepoName } from '../../src/lib/pulls/pull-rows';
import { openPull, review, tracked } from '../fixtures';

describe('rowStatus', () => {
	test('a running review outranks open findings, conflicts and failing checks', () => {
		const listed = {
			item: openPull({ mergeability: 'conflicts', checks: { passed: 0, failed: 2, pending: 0 } }),
			review: review({ status: 'running' })
		};

		expect(rowStatus(listed)).toEqual({ kind: 'reviewing' });
	});

	test('open findings count quality findings as suggestions and leave decided ones out', () => {
		const findings: ReviewListItem['findings'] = [
			{ id: 'a', severity: 'error', kind: 'bug' },
			{ id: 'b', severity: 'info', kind: 'quality' },
			{ id: 'c', severity: 'error', kind: 'bug', decision: { state: 'dismissed', reason: 'wrong', decidedAt: '' } }
		];

		expect(rowStatus({ item: openPull(), review: review({ findings }) })).toEqual({
			kind: 'bugs',
			bugs: 1,
			warnings: 0,
			suggestions: 1
		});
	});

	test('open findings count warnings apart from bugs and leave FYI notes out', () => {
		const findings: ReviewListItem['findings'] = [
			{ id: 'a', severity: 'error', tier: 'bug', kind: 'bug' },
			{ id: 'b', severity: 'warning', tier: 'warning', kind: 'bug' },
			{ id: 'c', severity: 'info', tier: 'fyi', kind: 'bug' },
			{ id: 'd', severity: 'info', kind: 'bug' }
		];

		expect(rowStatus({ item: openPull(), review: review({ findings }) })).toEqual({
			kind: 'bugs',
			bugs: 1,
			warnings: 2,
			suggestions: 0
		});
	});

	test('a failed review reads as failed, but a cancelled one as not reviewed, with when it was stopped', () => {
		expect(
			rowStatus({ item: openPull(), review: review({ status: 'failed', summary: 'Checkout timed out.' }) })
		).toEqual({
			kind: 'review-failed'
		});

		const cancelled = review({ status: 'failed', summary: REVIEW_CANCELLED });

		expect(rowStatus({ item: openPull(), review: cancelled })).toEqual({
			kind: 'not-reviewed',
			cancelledAt: cancelled.updatedAt
		});
	});

	test('conflicts come before failing checks, and failing checks before a draft', () => {
		const failing = { passed: 0, failed: 3, pending: 0 };

		expect(rowStatus({ item: openPull({ mergeability: 'conflicts', checks: failing }), review: review() })).toEqual({
			kind: 'conflicts'
		});

		expect(rowStatus({ item: openPull({ draft: true, checks: failing }), review: review() })).toEqual({
			kind: 'checks-failing',
			failed: 3
		});

		expect(rowStatus({ item: openPull({ draft: true }), review: review() })).toEqual({ kind: 'draft' });
	});

	test('no review, or only a draft session, reads as not reviewed', () => {
		expect(rowStatus({ item: openPull(), review: null })).toEqual({ kind: 'not-reviewed', cancelledAt: null });

		expect(rowStatus({ item: openPull(), review: review({ status: 'draft' }) })).toEqual({
			kind: 'not-reviewed',
			cancelledAt: null
		});
	});

	test('a clean review of an older head is outdated', () => {
		expect(rowStatus({ item: openPull(), review: review({ headSha: 'older' }) })).toEqual({ kind: 'outdated' });
	});

	test('a clean review is ready only when the forge can merge and no check is pending', () => {
		expect(rowStatus({ item: openPull(), review: review() })).toEqual({ kind: 'ready' });

		expect(rowStatus({ item: openPull({ checks: { passed: 1, failed: 0, pending: 1 } }), review: review() })).toEqual({
			kind: 'reviewed'
		});

		expect(rowStatus({ item: openPull({ mergeability: 'blocked' }), review: review() })).toEqual({ kind: 'reviewed' });
	});
});

describe('needsReview', () => {
	test('holds without a review at the current head, and not while one runs there', () => {
		expect(needsReview({ item: openPull(), review: null })).toBe(true);
		expect(needsReview({ item: openPull(), review: review({ headSha: 'older' }) })).toBe(true);
		expect(needsReview({ item: openPull(), review: review({ status: 'failed', summary: 'Boom.' }) })).toBe(true);
		expect(needsReview({ item: openPull(), review: review({ status: 'queued' }) })).toBe(false);
		expect(needsReview({ item: openPull(), review: review() })).toBe(false);
	});
});

describe('the repository name a row shows', () => {
	test('a repository alone with its short name shows only that name', () => {
		const repos = [tracked('r1', 'acme/api'), tracked('r2', 'acme/web')];

		expect(shortRepoName(repos, 'r1')).toBe('api');
	});

	test('two tracked repositories with one short name each show their owner', () => {
		const repos = [tracked('r1', 'acme/api'), tracked('r2', 'globex/api')];

		expect([shortRepoName(repos, 'r1'), shortRepoName(repos, 'r2')]).toEqual(['acme/api', 'globex/api']);
	});

	test('short names that differ only in case count as one name', () => {
		const repos = [tracked('r1', 'acme/API'), tracked('r2', 'globex/api')];

		expect([shortRepoName(repos, 'r1'), shortRepoName(repos, 'r2')]).toEqual(['acme/API', 'globex/api']);
	});
});
