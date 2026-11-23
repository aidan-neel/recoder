import type { Finding, PersonProfile, PersonSummary, Repo } from '@recoder/shared';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { accounts } from '../../src/accounts/account-records';
import { createSession, SESSION_COOKIE } from '../../src/accounts/sessions';
import { setGitlabHost } from '../../src/forge/gitlab-host';
import { clearToken, setToken } from '../../src/forge/tokens';
import { collection } from '../../src/storage/backend';
import { db } from '../../src/store';
import { clearAllCaches } from '../../src/util/ttl-cache';
import { fakeGh } from '../helpers/fake-gh';
import { restoreFetch, stubForge } from '../helpers/forge-fetch';
import { sendAs } from '../helpers/local-app';
import { testReview } from '../helpers/review';
import { testAccount } from '../helpers/test-account';

const oldPath = process.env.PATH;
const host = 'git.acme.test';
let cookie: string;

beforeEach(async () => {
	const admin = testAccount('owner', 'cameron', '1');

	await accounts.update(admin.id, () => admin);
	cookie = `${SESSION_COOKIE}=${(await createSession(admin.id)).token}`;
	setToken('github', 'profile-github-fixture');
	setToken('gitlab', 'profile-gitlab-fixture');
	setGitlabHost(host);
});

afterEach(async () => {
	restoreFetch();
	process.env.PATH = oldPath;
	clearToken('github');
	clearToken('gitlab');
	setGitlabHost(null);
	clearAllCaches();

	await Promise.all([
		collection('accounts').clear(),
		collection('sessions').clear(),
		db.repos.clear(),
		db.reviews.clear()
	]);
});

async function track(id: string, provider: 'github' | 'gitlab'): Promise<Repo> {
	const at = new Date().toISOString();

	const repo: Repo = {
		id,
		provider,
		url: `https://${provider === 'github' ? 'github.com' : host}/org/${id}`,
		name: `org/${id}`,
		defaultBranch: 'main',
		createdAt: at,
		updatedAt: at
	};

	await db.repos.set(repo);

	return repo;
}

function get(path: string): Promise<Response> {
	return sendAs(`/api/people${path}`, 'GET', cookie);
}

async function profile(path: string): Promise<PersonProfile> {
	const result = await get(path);

	expect(result.status).toBe(200);

	return result.json();
}

test('the people directory exposes only identities for other active accounts', async () => {
	const member = testAccount('member:github::2', 'mira', '2');
	const removed = testAccount('member:github::3', 'sam', '3');

	await accounts.update(member.id, () => member);
	await accounts.update(removed.id, () => ({ ...removed, removedAt: removed.createdAt }));

	const people = (await (await get('')).json()) as PersonSummary[];

	expect(people).toEqual([
		{ provider: 'github', host: null, login: 'mira', accountId: member.id, name: null, avatarUrl: null }
	]);
});

test('membership follows the remote ID after a forge rename and never follows a recycled login', async () => {
	const account = testAccount('member:github::7', 'mira', '7');

	await accounts.update(account.id, () => account);

	const calls = stubForge(({ url }) => {
		if (url === 'https://api.github.com/users/mirarenamed') return [200, { id: 7, login: 'MiraRenamed' }];
		if (url === 'https://api.github.com/users/mira') return [200, { id: 17, login: 'mira' }];

		throw new Error('Unexpected forge read.');
	});

	expect(await profile('/github/mirarenamed')).toMatchObject({
		person: { login: 'MiraRenamed' },
		membership: { status: 'member', accountId: account.id },
		canMessage: true
	});

	expect(await profile('/github/mira')).toMatchObject({ membership: { status: 'none' }, canMessage: false });

	await accounts.update(account.id, () => ({ ...account, removedAt: account.createdAt }));
	expect(await profile('/github/mirarenamed')).toMatchObject({ membership: { status: 'removed' }, canMessage: false });
	expect(calls).toHaveLength(2);
});

test('a forge Bot type is recognized even when the login has no bot suffix', async () => {
	stubForge(() => [200, { id: 7, login: 'robot', type: 'Bot' }]);

	expect(await profile('/github/robot')).toMatchObject({ person: { bot: true }, canMessage: false });
});

test('an unknown GitLab host cannot make the server call it', async () => {
	const calls = stubForge(() => [200, []]);

	expect((await get('/gitlab/mira?host=other.example')).status).toBe(404);
	expect(calls).toEqual([]);
});

test('a failed identity lookup and repository leave open and merged pulls from the other repository usable', async () => {
	const repo = await track('working', 'gitlab');
	const failed = await track('broken', 'gitlab');
	const at = new Date().toISOString();
	const avatarUrl = `https://${host}/uploads/people/bot.png`;
	const author = { username: 'mira[bot]', avatar_url: avatarUrl };

	const calls = stubForge(({ url }) => {
		const { hostname, pathname, searchParams } = new URL(url);

		expect(hostname).toBe(host);
		if (pathname.endsWith('/users')) return [500, { message: 'Private forge error' }];
		if (pathname.includes('org%2Fbroken')) return [500, { message: 'Private forge error' }];
		if (!pathname.includes('org%2Fworking')) throw new Error('Unexpected repository.');
		if (pathname.endsWith('/diffs')) return [200, []];
		if (searchParams.get('state') === 'opened')
			return [200, [{ iid: 1, author, title: 'Open', state: 'opened', created_at: at }]];

		expect(searchParams.get('author_username')).toBe('mira[bot]');

		return [200, [{ iid: 2, author, title: 'Merged', state: 'merged', created_at: at, merged_at: at }]];
	});

	const result = await profile(`/gitlab/mira%5Bbot%5D?host=${host}`);

	expect(result).toMatchObject({
		person: { login: 'mira[bot]', avatarUrl, bot: true },
		membership: { status: 'none' },
		canMessage: false,
		figures: { openPulls: 1, unreviewed: 1, merged: 1 },
		openPulls: [{ repoId: repo.id, pull: { number: 1, authorAvatarUrl: avatarUrl }, review: null }],
		recentlyMerged: [{ repoId: repo.id, pull: { number: 2, authorAvatarUrl: avatarUrl }, status: { state: 'merged' } }],
		repositories: [{ repoId: repo.id, pulls: 2 }],
		failures: [{ repoId: failed.id, error: 'The forge could not answer.' }]
	});

	expect(calls.some(({ url }) => url.includes('org%2Fbroken'))).toBe(true);
});

test('an older tracked pull can establish a profile when the forge no longer returns the user', async () => {
	await track('archive', 'gitlab');

	const avatarUrl = `https://${host}/uploads/people/mira.png`;

	stubForge(({ url }) => {
		const { pathname, searchParams } = new URL(url);

		if (pathname.endsWith('/users') || searchParams.has('state')) return [200, []];

		expect(pathname).toBe('/api/v4/projects/org%2Farchive/merge_requests');
		expect(searchParams.get('author_username')).toBe('mira');

		return [200, [{ iid: 1, author: { username: 'Mira', avatar_url: avatarUrl }, state: 'closed' }]];
	});

	expect(await profile(`/gitlab/mira?host=${host}`)).toMatchObject({
		person: { login: 'Mira', avatarUrl },
		membership: { status: 'none' },
		openPulls: [],
		recentlyMerged: []
	});
});

test('GitHub profile joins the newest real review and limits merged search to its tracked repository', async () => {
	const member = testAccount('member:github::7', 'mira', '7');
	const repo = await track('tracked', 'github');
	const at = new Date().toISOString();
	const avatarUrl = 'https://avatars.githubusercontent.com/u/7';
	const finding: Finding = { id: 'open', file: 'test.ts', message: 'Missing branch', severity: 'error', tier: 'bug' };

	const review = testReview({
		repoId: repo.id,
		prNumber: 1,
		startedBy: member.id,
		findings: [
			finding,
			{ ...finding, id: 'accepted', decision: { state: 'accepted', decidedAt: at } },
			{ ...finding, id: 'warning', severity: 'warning', tier: 'warning' }
		]
	});

	await accounts.update(member.id, () => member);
	await db.reviews.set(review);
	await db.reviews.set(testReview({ repoId: repo.id, prNumber: 1, status: 'draft' }));

	const gh = await fakeGh({
		'api-graphql': [
			{
				out: {
					data: {
						repository: {
							pullRequests: {
								pageInfo: { hasNextPage: false },
								nodes: [{ number: 1, author: { login: 'mira', avatarUrl }, createdAt: at, updatedAt: at }]
							}
						}
					}
				}
			}
		]
	});

	process.env.PATH = gh.path;

	stubForge(({ url }) => {
		const { pathname, searchParams } = new URL(url);

		if (pathname === '/users/mira') return [200, { id: 7, login: 'mira', avatar_url: avatarUrl }];

		if (pathname === '/search/issues') {
			expect(searchParams.get('q')).toMatch(/^is:pr is:merged author:mira repo:org\/tracked merged:>=/);

			return [200, { total_count: 1, items: [{ number: 2, pull_request: { merged_at: at } }] }];
		}

		if (pathname === '/repos/org/tracked/pulls/2')
			return [200, { number: 2, user: { login: 'mira', avatar_url: avatarUrl }, merged_at: at }];

		throw new Error('Unexpected forge read.');
	});

	expect(await profile('/github/mira')).toMatchObject({
		figures: {
			openPulls: 1,
			unreviewed: 0,
			openBugs: 1,
			merged: 1,
			findingsRaised: 3,
			findingsFixed: 1,
			reviewsRun: 1
		},
		openPulls: [{ pull: { authorAvatarUrl: avatarUrl }, review: { id: review.id } }],
		recentlyMerged: [{ pull: { number: 2, authorAvatarUrl: avatarUrl } }],
		reviewsRun: [{ id: review.id }]
	});
});
