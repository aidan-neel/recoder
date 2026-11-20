import { expect, test } from 'bun:test';
import type { Finding } from '@recoder/shared';
import { buildRepoOverview, type RepoOverviewInput } from '../../src/telemetry/repo-overview';
import { testReview } from '../helpers/review';

const NOW = new Date('2026-11-16T12:00:00.000Z');

test('FYI stays out of bug hotspots while legacy low findings still count as bugs', () => {
	const result = overview({
		reviews: [
			testReview({
				repoId: 'repo',
				startedAt: '2026-11-15T10:00:00.000Z',
				findings: [bug('note', 'src/a.ts', { tier: 'fyi' }), bug('legacy-note', 'src/b.ts', { severity: 'info' })]
			})
		]
	});

	expect(result.findings.raised).toBe(2);
	expect(result.hotspots).toEqual([{ path: 'src/', findings: 1 }]);
	expect(result.daily.find((day) => day.day === '2026-11-15')?.withBugs).toBe(1);
});

/** A high bug in `file`; `overrides` replace any field. */
function bug(id: string, file: string, overrides: Partial<Finding> = {}): Finding {
	return { id, title: id, file, line: 1, severity: 'error', message: id, ...overrides };
}

/** The overview of `repo` over seven days ending on NOW. */
function overview(input: Partial<RepoOverviewInput>) {
	return buildRepoOverview({
		repoId: 'repo',
		days: 7,
		now: NOW,
		reviews: [],
		pullStates: [],
		autoReview: false,
		...input
	});
}

test('a review started the day before the window is left out, one on its first day counts', () => {
	const result = overview({
		reviews: [
			testReview({ repoId: 'repo', prNumber: 1, startedAt: '2026-11-09T23:59:59.000Z', findings: [bug('a', 'x.ts')] }),
			testReview({ repoId: 'repo', prNumber: 2, startedAt: '2026-11-10T00:00:00.000Z', findings: [bug('b', 'x.ts')] })
		]
	});

	expect(result.reviewedPulls).toBe(1);
	expect(result.findings.raised).toBe(1);
	expect(result.daily[0]).toEqual({ day: '2026-11-10', reviews: 1, withBugs: 1 });
});

test('the typical review time is the median of the passed reviews in the window', () => {
	const took = (prNumber: number, minutes: number, status: 'passed' | 'failed' = 'passed') =>
		testReview({
			repoId: 'repo',
			prNumber,
			status,
			startedAt: '2026-11-15T10:00:00.000Z',
			createdAt: '2026-11-15T10:00:00.000Z',
			updatedAt: new Date(Date.parse('2026-11-15T10:00:00.000Z') + minutes * 60_000).toISOString()
		});

	const result = overview({ reviews: [took(1, 2), took(2, 10), took(3, 4), took(4, 6), took(5, 90, 'failed')] });

	expect(result.typicalReviewMs).toBe(5 * 60_000);
});

test('bugs land in the directory of their file, most first, with suggestions and quieted findings left out', () => {
	const result = overview({
		reviews: [
			testReview({
				repoId: 'repo',
				startedAt: '2026-11-15T10:00:00.000Z',
				findings: [
					bug('a', 'src/forge/gh.ts'),
					bug('b', 'src/forge/glab.ts'),
					bug('c', 'src/review/run.ts'),
					bug('d', 'README.md'),
					bug('e', 'src/review/style.ts', { kind: 'quality' }),
					bug('f', 'src/review/old.ts', { topic: { id: 't', label: 't', quieted: true } })
				]
			})
		]
	});

	expect(result.hotspots).toEqual([
		{ path: 'src/forge/', findings: 2 },
		{ path: '/', findings: 1 },
		{ path: 'src/review/', findings: 1 }
	]);
});
