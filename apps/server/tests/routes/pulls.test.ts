import { afterEach, expect, test } from 'bun:test';
import type { PullDiff, PullList, PullPage } from '@recoder/shared';
import { app } from '../../src/app';
import { db } from '../../src/store';
import { fakeGh } from '../helpers/fake-gh';
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

	const { id } = (await added.json()) as { id: string };

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

function post(path: string, body: unknown): Response | Promise<Response> {
	return app.request(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

const HEAD = 'b'.repeat(40);

/** `gh pr view` for open, ready PR 7 at {@link HEAD}, in a repository that allows merge commits and squashes. */
function openPullGh() {
	return fakeGh({
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
			}
		],
		'repo-view': [{ out: { mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false } }]
	});
}

test('a local pull request page offers no comments, checks or merge methods', async () => {
	const { repo } = await localRepo();

	const res = await app.request(`/api/repos/${repo.id}/pulls/7/page`);
	const page = (await res.json()) as PullPage;

	expect(res.status).toBe(200);
	expect(page.provider).toBe('local');
	expect(page.capabilities).toEqual({ comments: false, checks: false, mergeMethods: [] });
	expect(page.status).toMatchObject({ state: 'open', mergeability: 'unknown', checks: null });
	expect(page.review).toBeNull();
});

test('a merged pull request still has a page', async () => {
	const { repo } = await localRepo();

	const page = (await (await app.request(`/api/repos/${repo.id}/pulls/3/page`)).json()) as PullPage;

	expect(page.status.state).toBe('merged');
});

test('the diff answers its head commit as the ETag, and 304 when the client already has it', async () => {
	const { repo, pull7Head } = await localRepo();
	const path = `/api/repos/${repo.id}/pulls/7/diff`;

	const first = await app.request(path);
	const diff = (await first.json()) as PullDiff;

	expect(first.headers.get('etag')).toBe(`"${pull7Head}"`);
	expect(diff.headSha).toBe(pull7Head);
	expect(diff.files.map((file) => file.path)).toContain('a.ts');

	const again = await app.request(path, { headers: { 'If-None-Match': `"${pull7Head}"` } });

	expect(again.status).toBe(304);
	expect(again.headers.get('etag')).toBe(`"${pull7Head}"`);
});

test('commits list oldest first', async () => {
	const { repo, pull7Commit, pull7Head } = await localRepo();

	const commits = (await (await app.request(`/api/repos/${repo.id}/pulls/7/commits`)).json()) as { sha: string }[];

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

	const list = (await (await app.request('/api/pulls')).json()) as PullList;
	const mine = list.items.filter((item) => item.repoId === repo.id);

	expect(mine.map((item) => item.pull.number)).toEqual([7]);
	expect(list.failures.filter((failure) => failure.repoId === id)).toHaveLength(1);
});
