import { afterEach, expect, test } from 'bun:test';
import type { PullDiff, PullList, PullPage } from '@recoder/shared';
import { app } from '../../src/app';
import { pullStateKey, pullStates } from '../../src/forge/pulls/pull-states';
import { db } from '../../src/store';
import { fakeGh, type GhReply } from '../helpers/fake-gh';
import { localForgeFixture } from '../helpers/local-forge';

const realPath = process.env.PATH;

/** Repositories a test tracked; the store outlives the file, and other suites list every repository. */
const tracked: string[] = [];

afterEach(async () => {
	process.env.PATH = realPath;
	await Promise.all(tracked.splice(0).map((id) => db.repos.delete(id)));
});

/** A GitHub repository added the way the app adds one. */
async function githubRepo(): Promise<string> {
	const added = await app.request('/api/repos', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: 'acme/app', url: 'https://github.com/acme/app' })
	});

	const { id } = await answer<{ id: string }>(added);

	tracked.push(id);

	return id;
}

/** The fixture's local repository, tracked. */
async function localRepo() {
	const fixture = await localForgeFixture();

	await db.repos.set(fixture.repo);
	tracked.push(fixture.repo.id);

	return fixture;
}

/**
 * A route's JSON answer as the shared type the route declares it answers.
 * `json()` is untyped, and a test that reads the wrong shape fails on its own
 * assertions, so no cast is needed.
 */
function answer<T>(res: Response): Promise<T> {
	return res.json();
}

function post(path: string, body: unknown): Response | Promise<Response> {
	return app.request(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

const HEAD = 'b'.repeat(40);

/** A token the way GitHub shapes one, which a response must never quote. */
const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123';

/**
 * `gh pr view` for open, ready PR 7 at {@link HEAD}, in a repository that
 * allows merge commits and squashes, plus the `more` replies and later `pr
 * view` answers a test needs.
 */
function openPullGh(more: Record<string, GhReply[]> = {}, views: GhReply[] = []) {
	return fakeGh({
		...more,
		'pr-view': [
			{
				out: {
					number: 7,
					title: 'Fix it',
					headRefOid: HEAD,
					createdAt: '2026-11-01T00:00:00Z',
					state: 'OPEN',
					isDraft: false,
					mergeStateStatus: 'CLEAN'
				}
			},
			...views
		],
		'repo-view': [
			{
				out: {
					viewerPermission: 'ADMIN',
					mergeCommitAllowed: true,
					squashMergeAllowed: true,
					rebaseMergeAllowed: false
				}
			}
		]
	});
}

test('a local pull request page offers no comments, checks or merge methods', async () => {
	const { repo } = await localRepo();

	const res = await app.request(`/api/repos/${repo.id}/pulls/7/page`);
	const page = await answer<PullPage>(res);

	expect(res.status).toBe(200);
	expect(page.provider).toBe('local');
	expect(page.capabilities).toEqual({ comments: false, checks: false, mergeMethods: [] });
	expect(page.status).toMatchObject({ state: 'open', mergeability: 'unknown', checks: null });
	expect(page.review).toBeNull();
});

test('a merged pull request still has a page', async () => {
	const { repo } = await localRepo();

	const page = await answer<PullPage>(await app.request(`/api/repos/${repo.id}/pulls/3/page`));

	expect(page.status.state).toBe('merged');
});

test('the diff answers its head commit as the ETag, and 304 when the client already has it', async () => {
	const { repo, pull7Head } = await localRepo();
	const path = `/api/repos/${repo.id}/pulls/7/diff`;

	const first = await app.request(path);
	const diff = await answer<PullDiff>(first);

	expect(first.headers.get('etag')).toBe(`"${pull7Head}"`);
	expect(diff.headSha).toBe(pull7Head);
	expect(diff.files.map((file) => file.path)).toContain('a.ts');

	const again = await app.request(path, { headers: { 'If-None-Match': `"${pull7Head}"` } });

	expect(again.status).toBe(304);
	expect(again.headers.get('etag')).toBe(`"${pull7Head}"`);
});

test('commits list oldest first', async () => {
	const { repo, pull7Commit, pull7Head } = await localRepo();

	const commits = await answer<{ sha: string }[]>(await app.request(`/api/repos/${repo.id}/pulls/7/commits`));

	expect(commits.map((commit) => commit.sha)).toEqual([pull7Commit, pull7Head]);
});

test('a local repository refuses comments and merges with 400', async () => {
	const { repo, pull7Head } = await localRepo();

	const read = await app.request(`/api/repos/${repo.id}/pulls/7/comments`);
	const comment = await post(`/api/repos/${repo.id}/pulls/7/comments`, { body: 'Hi' });
	const merge = await post(`/api/repos/${repo.id}/pulls/7/merge`, { method: 'merge', headSha: pull7Head });

	expect([read.status, comment.status, merge.status]).toEqual([400, 400, 400]);
});

test('a pull request number that is not a positive integer is refused', async () => {
	const { repo } = await localRepo();

	const res = await app.request(`/api/repos/${repo.id}/pulls/0/page`);

	expect(res.status).toBe(400);
});

test('a comment body that is blank or too long is refused before the forge is asked', async () => {
	const id = await githubRepo();
	const gh = await fakeGh({});

	process.env.PATH = gh.path;

	const blank = await post(`/api/repos/${id}/pulls/7/comments`, { body: '  \n ' });
	const long = await post(`/api/repos/${id}/pulls/7/comments`, { body: 'x'.repeat(65_537) });

	expect([blank.status, long.status]).toEqual([400, 400]);
	expect(await gh.calls()).toEqual([]);
});

test('a merge at a head the pull request moved past is refused with 409 and never reaches gh pr merge', async () => {
	const id = await githubRepo();
	const gh = await openPullGh();

	process.env.PATH = gh.path;

	const res = await post(`/api/repos/${id}/pulls/7/merge`, { method: 'squash', headSha: 'a'.repeat(40) });

	expect(res.status).toBe(409);
	expect((await gh.calls()).some((call) => call.startsWith('pr merge'))).toBe(false);
});

test('a merge method the repository does not allow is refused with 400', async () => {
	const id = await githubRepo();
	const gh = await openPullGh();

	process.env.PATH = gh.path;

	const res = await post(`/api/repos/${id}/pulls/7/merge`, { method: 'rebase', headSha: HEAD });

	expect(res.status).toBe(400);
	expect(await res.json()).toEqual({ error: expect.stringContaining('rebase') });
	expect((await gh.calls()).some((call) => call.startsWith('pr merge'))).toBe(false);
});

test('the list loads the repositories that answer and names the one that failed', async () => {
	const { repo } = await localRepo();
	const id = await githubRepo();
	const gh = await fakeGh({ 'pr-list': [{ err: 'gh auth login required' }] });

	process.env.PATH = gh.path;

	const list = await answer<PullList>(await app.request('/api/pulls'));
	const mine = list.items.filter((item) => item.repoId === repo.id);

	expect(mine.map((item) => item.pull.number)).toEqual([7]);
	expect(list.failures.filter((failure) => failure.repoId === id)).toHaveLength(1);
});

test('a merge the forge took records the pull request as merged', async () => {
	const id = await githubRepo();

	/** The merge reads `pr view` again to confirm, so the second answer reports the pull request merged. */
	const gh = await openPullGh({ 'pr-merge': [{ text: '' }] }, [
		{ out: { state: 'MERGED', mergeCommit: { oid: 'c'.repeat(40) } } }
	]);

	process.env.PATH = gh.path;

	const res = await post(`/api/repos/${id}/pulls/7/merge`, { method: 'squash', headSha: HEAD });

	expect(res.status).toBe(200);
	expect(await answer<{ merged: boolean }>(res)).toMatchObject({ merged: true });
	expect((await pullStates.get(pullStateKey(id, 7)))?.state).toBe('merged');

	await pullStates.delete(pullStateKey(id, 7));
});

test('a push between the merge check and the merge is refused with 409', async () => {
	const id = await githubRepo();

	const gh = await openPullGh({
		'pr-merge': [{ err: 'GraphQL: Head branch was modified. Review and try the merge again.' }]
	});

	process.env.PATH = gh.path;

	const res = await post(`/api/repos/${id}/pulls/7/merge`, { method: 'squash', headSha: HEAD });

	expect(res.status).toBe(409);
	expect(await answer<{ error: string }>(res)).toEqual({ error: expect.stringContaining('new commits') });
});

test('a forge failure answers its kind in fixed words, never the forge output', async () => {
	const id = await githubRepo();

	const gh = await fakeGh({
		'pr-view': [{ err: `fatal: unable to access 'https://octo:${TOKEN}@github.com/acme/app'` }]
	});

	process.env.PATH = gh.path;

	const res = await app.request(`/api/repos/${id}/pulls/7/page`);

	expect(res.status).toBe(502);
	expect(await res.text()).not.toContain(TOKEN);
});

test('a tracked URL with credentials in it that names no repository answers without them', async () => {
	const now = new Date().toISOString();
	const id = crypto.randomUUID();

	await db.repos.set({
		id,
		name: 'owner',
		url: `https://octo:${TOKEN}@github.com/owner`,
		provider: 'github',
		defaultBranch: 'main',
		createdAt: now,
		updatedAt: now
	});

	tracked.push(id);

	const res = await app.request(`/api/repos/${id}/pulls/7/page`);

	expect(res.status).toBe(502);
	expect(await res.text()).not.toContain(TOKEN);
});
