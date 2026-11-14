import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { PullState, Repo } from '@recoder/shared';
import { pullStateKey, pullStates } from '../../../src/forge/pulls/pull-states';
import { sweepPullStates } from '../../../src/forge/pulls/state-sweep';
import { db } from '../../../src/store';
import { fakeGh, type GhReply } from '../../helpers/fake-gh';
import { localForgeFixture } from '../../helpers/local-forge';
import { testReview } from '../../helpers/review';

const realPath = process.env.PATH;

/** The sweep reads every review and repository, so each test starts from none and leaves none behind. */
async function clearSweepTables(): Promise<void> {
	await pullStates.clear();
	await db.reviews.clear();
	await db.repos.clear();
}

beforeEach(clearSweepTables);

afterEach(async () => {
	process.env.PATH = realPath;
	await clearSweepTables();
});

/** A connected GitHub repository that asks the forge through `gh`. */
async function githubRepo(): Promise<Repo> {
	const repo: Repo = {
		id: crypto.randomUUID(),
		name: 'acme/app',
		url: 'https://github.com/acme/app',
		provider: 'github',
		defaultBranch: 'main',
		createdAt: '',
		updatedAt: ''
	};

	await db.repos.set(repo);

	return repo;
}

/** A pull request's state record, as a past read left it. */
async function knownState(repo: Repo, n: number, state: PullState, checkedAt: string): Promise<void> {
	await pullStates.set({ id: pullStateKey(repo.id, n), repoId: repo.id, number: n, state, checkedAt });
}

/** A `gh pr view` answer for a pull request in `state`. */
function viewedPull(n: number, state: 'OPEN' | 'MERGED' | 'CLOSED'): GhReply {
	return {
		out: {
			number: n,
			title: 'Fix it',
			headRefOid: 'b'.repeat(40),
			createdAt: '2026-11-01T00:00:00Z',
			state,
			isDraft: false,
			statusCheckRollup: []
		}
	};
}

test('the sweep records the state of each pull request its newest review names', async () => {
	const { repo } = await localForgeFixture();

	await db.repos.set(repo);
	await db.reviews.set(testReview({ repoId: repo.id, prNumber: 3 }));
	await db.reviews.set(testReview({ repoId: repo.id, prNumber: 7 }));

	await sweepPullStates();

	expect((await pullStates.get(pullStateKey(repo.id, 3)))?.state).toBe('merged');
	expect((await pullStates.get(pullStateKey(repo.id, 7)))?.state).toBe('open');
});

test.each([
	{ when: 'already known merged, however long ago', state: 'merged' as const, checkedAt: new Date(0) },
	{ when: 'checked in the last few minutes', state: 'open' as const, checkedAt: new Date() }
])('a pull request $when is not asked of the forge', async ({ state, checkedAt }) => {
	const repo = await githubRepo();
	const gh = await fakeGh({ 'pr-view': [{ err: 'should never run' }] });

	process.env.PATH = gh.path;

	await knownState(repo, 7, state, checkedAt.toISOString());
	await db.reviews.set(testReview({ repoId: repo.id, prNumber: 7 }));

	await sweepPullStates();

	expect(await gh.calls()).toEqual([]);
});

test('a closed pull request is re-checked slowly in case it reopened', async () => {
	const repo = await githubRepo();

	const gh = await fakeGh({ 'pr-view': [viewedPull(7, 'OPEN')] });

	process.env.PATH = gh.path;

	const checkedAt = Date.parse('2026-11-10T00:00:00Z');
	const halfHour = checkedAt + 30 * 60_000;
	const twoHours = checkedAt + 2 * 60 * 60_000;

	await knownState(repo, 7, 'closed', new Date(checkedAt).toISOString());
	await db.reviews.set(testReview({ repoId: repo.id, prNumber: 7 }));

	await sweepPullStates(halfHour);
	expect(await gh.calls()).toEqual([]);

	await sweepPullStates(twoHours);
	expect(await gh.calls()).toEqual([expect.stringContaining('pr view')]);
	expect((await pullStates.get(pullStateKey(repo.id, 7)))?.state).toBe('open');
});

test('a forge error skips the pull request and records nothing for it', async () => {
	const repo = await githubRepo();

	const gh = await fakeGh({ 'pr-view': [{ err: 'gh auth login required' }, viewedPull(8, 'MERGED')] });

	process.env.PATH = gh.path;

	await db.reviews.set(testReview({ repoId: repo.id, prNumber: 7 }));
	await db.reviews.set(testReview({ repoId: repo.id, prNumber: 8, updatedAt: '2020-01-01T00:00:00Z' }));

	await sweepPullStates();

	expect(await pullStates.get(pullStateKey(repo.id, 7))).toBeUndefined();
	expect((await pullStates.get(pullStateKey(repo.id, 8)))?.state).toBe('merged');
});
