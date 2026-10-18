import { describe, expect, test } from 'bun:test';
import type { Finding, PullRequest, Review } from '@recoder/shared';

import { entryAction, queueEntry, queueSections } from '../../src/lib/queue/queue';

const REPO = { id: 'r1', name: 'acme/api' };

function pull(number: number, hoursAgo: number, headSha = `sha${number}`): PullRequest {
	return {
		number,
		title: `PR ${number}`,
		url: `https://github.com/acme/api/pull/${number}`,
		author: 'claude[bot]',
		base: 'main',
		headRef: `agent/pr-${number}`,
		headSha,
		additions: 1,
		deletions: 1,
		changedFiles: 1,
		createdAt: new Date(Date.parse('2026-10-13T10:00:00Z') - hoursAgo * 3_600_000).toISOString()
	};
}

function review(
	number: number,
	status: Review['status'],
	severities: Finding['severity'][] = [],
	headSha = `sha${number}`
) {
	return {
		id: `rv-${number}`,
		repoId: REPO.id,
		prNumber: number,
		headSha,
		status,
		summary: null,
		findings: severities.map((severity, index) => ({
			id: `rv-${number}-${index}`,
			file: 'src/a.ts',
			severity,
			message: 'A finding.'
		})),
		runs: [],
		source: 'github',
		prTitle: null,
		prUrl: null,
		createdAt: '2026-10-13T09:00:00Z',
		updatedAt: '2026-10-13T09:00:00Z'
	} satisfies Review;
}

describe('queue', () => {
	test('a failed review of an older commit reads as outdated, so the row reviews the new head', () => {
		const entry = queueEntry(REPO, pull(7, 1), review(7, 'failed', [], 'old-sha'), {});

		expect(entry.state).toBe('outdated');
		expect(entryAction(entry)).toEqual({ label: 'Review again', starts: true });
	});

	test('sections come in working order, strongest open tone first, then more open decisions, then newer', () => {
		const entries = [
			queueEntry(REPO, pull(1, 1), review(1, 'passed', []), {}),
			queueEntry(REPO, pull(2, 5), review(2, 'passed', ['warning']), {}),
			queueEntry(REPO, pull(3, 9), review(3, 'passed', ['warning', 'warning']), {}),
			queueEntry(REPO, pull(4, 2), review(4, 'passed', ['error']), {}),
			queueEntry(REPO, pull(5, 3), review(5, 'running'), {}),
			queueEntry(REPO, pull(6, 4), review(6, 'draft'), {}),
			queueEntry(REPO, pull(8, 6), review(8, 'passed', ['warning']), { 'rv-8-0': { state: 'sent', note: '', at: 1 } }),
			queueEntry(REPO, pull(9, 8), review(9, 'passed', ['warning']), {})
		];

		const sections = queueSections(entries).map((section) => [section.id, section.entries.map((e) => e.pull.number)]);

		expect(sections).toEqual([
			['needs-you', [4, 3, 2, 9]],
			['reviewing', [5]],
			['not-reviewed', [6]],
			['with-agent', [8]],
			['ready', [1]]
		]);
	});

	test('a reviewed row opens instead of starting, so a stray key never queues a second review of the same commit', () => {
		const ready = queueEntry(REPO, pull(1, 1), review(1, 'passed', []), {});
		const open = queueEntry(REPO, pull(2, 1), review(2, 'passed', ['error']), {});

		expect(entryAction(ready).starts).toBe(false);
		expect(entryAction(open).starts).toBe(false);
	});
});
