import { describe, expect, test } from 'bun:test';
import { REVIEW_CANCELLED, type PullListItem, type PullStatus, type ReviewListItem } from '@recoder/shared';

import { needsReview, rowStatus, shortRepoName } from '../../src/lib/pulls/pull-rows';
import { HEAD, review, tracked } from '../fixtures';

function item(status: Partial<PullStatus> = {}): PullListItem {
	return {
		repoId: 'r1',
		pull: {
			number: 7,
			title: 'Change',
			url: 'https://github.com/acme/api/pull/7',
			author: 'ana',
			base: 'main',
			headRef: 'feature',
			headSha: HEAD,
			additions: 1,
			deletions: 1,
			changedFiles: 1,
			createdAt: ''
		},
		status: {
			state: 'open',
			draft: false,
			mergeability: 'clean',
			updatedAt: '2026-10-13T09:00:00.000Z',
			checks: { passed: 2, failed: 0, pending: 0 },
			commits: 1,
			...status
		},
		review: null
	};
}

describe('rowStatus', () => {
	test('a running review outranks open findings, conflicts and failing checks', () => {
		const listed = {
			item: item({ mergeability: 'conflicts', checks: { passed: 0, failed: 2, pending: 0 } }),
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

		expect(rowStatus({ item: item(), review: review({ findings }) })).toEqual({
			kind: 'bugs',
			bugs: 1,
			suggestions: 1
		});
	});

	test('a failed review reads as failed, but a cancelled one as never reviewed', () => {
		expect(rowStatus({ item: item(), review: review({ status: 'failed', summary: 'Checkout timed out.' }) })).toEqual({
			kind: 'review-failed'
		});

		expect(rowStatus({ item: item(), review: review({ status: 'failed', summary: REVIEW_CANCELLED }) })).toEqual({
			kind: 'not-reviewed'
		});
	});

	test('conflicts come before failing checks, and failing checks before a draft', () => {
		const failing = { passed: 0, failed: 3, pending: 0 };

		expect(rowStatus({ item: item({ mergeability: 'conflicts', checks: failing }), review: review() })).toEqual({
			kind: 'conflicts'
		});

		expect(rowStatus({ item: item({ draft: true, checks: failing }), review: review() })).toEqual({
			kind: 'checks-failing',
			failed: 3
		});

		expect(rowStatus({ item: item({ draft: true }), review: review() })).toEqual({ kind: 'draft' });
	});

	test('no review, or only a draft session, reads as not reviewed', () => {
		expect(rowStatus({ item: item(), review: null })).toEqual({ kind: 'not-reviewed' });
		expect(rowStatus({ item: item(), review: review({ status: 'draft' }) })).toEqual({ kind: 'not-reviewed' });
	});

	test('a clean review of an older head is outdated', () => {
		expect(rowStatus({ item: item(), review: review({ headSha: 'older' }) })).toEqual({ kind: 'outdated' });
	});

	test('a clean review is ready only when the forge can merge and no check is pending', () => {
		expect(rowStatus({ item: item(), review: review() })).toEqual({ kind: 'ready' });

		expect(rowStatus({ item: item({ checks: { passed: 1, failed: 0, pending: 1 } }), review: review() })).toEqual({
			kind: 'reviewed'
		});

		expect(rowStatus({ item: item({ mergeability: 'blocked' }), review: review() })).toEqual({ kind: 'reviewed' });
	});
});

describe('needsReview', () => {
	test('holds without a review at the current head, and not while one runs there', () => {
		expect(needsReview({ item: item(), review: null })).toBe(true);
		expect(needsReview({ item: item(), review: review({ headSha: 'older' }) })).toBe(true);
		expect(needsReview({ item: item(), review: review({ status: 'failed', summary: 'Boom.' }) })).toBe(true);
		expect(needsReview({ item: item(), review: review({ status: 'queued' }) })).toBe(false);
		expect(needsReview({ item: item(), review: review() })).toBe(false);
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
