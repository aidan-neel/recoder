import { describe, expect, test } from 'bun:test';
import type { RepoOverview, ReviewListItem } from '@recoder/shared';

import { pullRow } from '../../src/lib/pulls/pull-rows';
import type { RowEntry } from '../../src/lib/pulls/use-rows';
import { fleetTiles, inScope, scopeCounts, type OverviewRead } from '../../src/lib/repo/fleet';
import { openPull, review, tracked } from '../fixtures';

const REPOS = [tracked('r1', 'acme/api'), tracked('r2', 'acme/web')];

const HIGH_BUG: ReviewListItem['findings'][number] = { id: 'a', severity: 'error', kind: 'bug' };
const LOW_BUG: ReviewListItem['findings'][number] = { id: 'b', severity: 'info', kind: 'bug' };

/** An open pull request of a repository as the list holds it, with the review its row shows. */
function entry(repoId: string, number: number, shown: ReviewListItem | null): RowEntry {
	const base = openPull();
	const listed = { item: { ...base, repoId, pull: { ...base.pull, number } }, review: shown };

	return { listed, row: pullRow(listed, REPOS, '') };
}

function overview(change: Partial<RepoOverview> = {}): RepoOverview {
	return {
		repoId: 'r1',
		days: 30,
		autoReview: true,
		reviewedPulls: 0,
		mergedPulls: 0,
		findings: { raised: 0, accepted: 0, dismissed: 0 },
		typicalReviewMs: null,
		daily: [],
		hotspots: [],
		merged: [],
		...change
	};
}

/** The tiles of the two repositories over `entries`, each overview as `overviews` gives it, else still loading. */
function tiles(entries: RowEntry[], overviews: Record<string, OverviewRead> = {}, reviews: ReviewListItem[] = []) {
	return fleetTiles({
		repos: REPOS,
		entries,
		openCounts: Object.fromEntries(
			REPOS.map((repo) => [repo.id, entries.filter((e) => e.row.repoId === repo.id).length])
		),
		reviews,
		overviewOf: (repoId) => overviews[repoId] ?? 'loading',
		base: ''
	});
}

describe('fleetTiles', () => {
	test('a repository counts its high bugs when it has any, and every open bug when it has none', () => {
		const [api, web] = tiles([
			entry('r1', 1, review({ findings: [LOW_BUG] })),
			entry('r2', 2, review({ findings: [HIGH_BUG, LOW_BUG] }))
		]);

		expect([web.name, web.bugs]).toEqual(['web', { count: 1, high: true }]);
		expect([api.name, api.bugs]).toEqual(['api', { count: 1, high: false }]);
	});

	test('a pull request with no review waits, and the tile names the one with a high bug before it', () => {
		const [api] = tiles([entry('r1', 1, null), entry('r1', 2, review({ findings: [HIGH_BUG] }))]);

		expect(api.second).toEqual({ kind: 'waiting', count: 1 });
		expect(api.needsYou).toBe(true);
		expect(api.foot).toMatchObject({ kind: 'next', row: { number: 2 } });
	});

	test('a repository with something to do sorts before a quiet one, whatever their names', () => {
		const sorted = tiles([entry('r2', 1, null), entry('r1', 2, review())]);

		expect(sorted.map((tile) => [tile.name, tile.needsYou, tile.clean])).toEqual([
			['web', true, false],
			['api', false, true]
		]);
	});

	test('auto review being off is the last line only when no pull request needs someone', () => {
		const off = overview({ autoReview: false });
		const [web, api] = tiles([entry('r1', 1, review()), entry('r2', 2, null)], { r1: off, r2: off });

		expect(web.foot.kind).toBe('next');
		expect(api.foot).toEqual({ kind: 'auto-off' });
	});

	test('a repository with nothing open says what merged and when its last review that is no draft changed', () => {
		const reviews = [
			review({ id: 'old', updatedAt: '2026-11-01T00:00:00.000Z' }),
			review({ id: 'new', updatedAt: '2026-11-09T00:00:00.000Z' }),
			review({ id: 'draft', status: 'draft', updatedAt: '2026-11-12T00:00:00.000Z' })
		];

		const [api] = tiles([], { r1: overview({ mergedPulls: 12 }) }, reviews);

		expect(api.second).toEqual({ kind: 'merged', count: 12, days: 30 });
		expect(api.foot).toEqual({ kind: 'caught-up', lastReviewAt: '2026-11-09T00:00:00.000Z' });
	});
});

describe('scopeCounts', () => {
	test('an overview that has not answered is under neither auto review scope', () => {
		const all = tiles([entry('r1', 1, null)], { r1: overview({ autoReview: false }) });

		expect(scopeCounts(all)).toEqual({ all: 2, 'needs-you': 1, quiet: 1, 'auto-off': 1 });
		expect(all.filter((tile) => inScope(tile, 'auto-off')).map((tile) => tile.name)).toEqual(['api']);
	});
});
