import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Repo } from '@recoder/shared';
import { repoFileHost } from './repo-files';
import { setToken } from './tokens';

const realFetch = globalThis.fetch;
type Call = { method: string; url: string; body: unknown };
let calls: Call[] = [];
let routes: [RegExp, (call: Call) => { status?: number; body: unknown }][] = [];

function mockFetch(): void {
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		const call = { method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined };
		calls.push(call);
		const route = routes.find(([pattern]) => pattern.test(`${call.method} ${url}`));
		const reply = route ? route[1](call) : { status: 404, body: { message: 'Not Found' } };
		return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
	}) as typeof fetch;
}

const repo = (url: string, provider: 'github' | 'gitlab'): Repo => ({ id: 'r1', name: 'o/r', url, provider, defaultBranch: 'main', createdAt: '', updatedAt: '' });

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-repo-files-'));
	delete process.env.GH_TOKEN;
	delete process.env.GITHUB_TOKEN;
	delete process.env.GITLAB_TOKEN;
	calls = [];
	routes = [];
	mockFetch();
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

test('GitHub: opens a branch, commits the file, and opens a pull request', async () => {
	setToken('github', 'tok');
	routes = [
		[/^GET .*\/repos\/o\/r$/, () => ({ body: { default_branch: 'main' } })],
		[/^GET .*\/branches\/main$/, () => ({ body: { commit: { sha: 'base-sha' } } })],
		[/^POST .*\/git\/refs$/, () => ({ status: 201, body: {} })],
		[/^PUT .*\/contents\/\.recoder\/REVIEW\.md$/, () => ({ status: 201, body: {} })],
		[/^POST .*\/pulls$/, () => ({ status: 201, body: { number: 12, html_url: 'https://github.com/o/r/pull/12' } })]
	];
	const host = repoFileHost(repo('https://github.com/o/r', 'github'));
	expect(host.canWrite()).toBe(true);
	const result = await host.propose({ path: '.recoder/REVIEW.md', content: '- Rule\n', branch: 'recoder/review-guidelines-x', title: 'T', body: 'B', commitMessage: 'M', pending: null });
	expect(result).toEqual({ number: 12, url: 'https://github.com/o/r/pull/12', branch: 'recoder/review-guidelines-x' });
	const writes = calls.filter((call) => call.method !== 'GET');
	expect(writes.map((call) => call.method)).toEqual(['POST', 'PUT', 'POST']);
	expect(writes[0].body).toEqual({ ref: 'refs/heads/recoder/review-guidelines-x', sha: 'base-sha' });
	expect(writes[1].body).toEqual({ message: 'M', content: Buffer.from('- Rule\n').toString('base64'), branch: 'recoder/review-guidelines-x' });
	expect(writes[2].body).toEqual({ title: 'T', head: 'recoder/review-guidelines-x', base: 'main', body: 'B' });
	expect(calls.every((call) => !call.url.includes('?') || !call.url.includes('token'))).toBe(true);
});

test('GitHub: updates the pending branch in place, passing the existing blob sha', async () => {
	setToken('github', 'tok');
	routes = [
		[/^GET .*\/repos\/o\/r$/, () => ({ body: { default_branch: 'main' } })],
		[/^GET .*\/branches\/main$/, () => ({ body: { commit: { sha: 'base-sha' } } })],
		[/^GET .*\/contents\/\.recoder\/REVIEW\.md\?ref=pending$/, () => ({ body: { type: 'file', sha: 'blob-1', content: Buffer.from('old').toString('base64') } })],
		[/^PUT .*\/contents\//, () => ({ body: {} })]
	];
	const pending = { number: 7, url: 'u', branch: 'pending' };
	const result = await repoFileHost(repo('https://github.com/o/r', 'github')).propose({ path: '.recoder/REVIEW.md', content: 'new', branch: 'unused', title: 'T', body: 'B', commitMessage: 'M', pending });
	expect(result).toBe(pending);
	const writes = calls.filter((call) => call.method !== 'GET');
	expect(writes).toHaveLength(1);
	expect(writes[0].body).toMatchObject({ branch: 'pending', sha: 'blob-1' });
});

test('GitHub: reads a file at a ref and finds a pending change by branch prefix', async () => {
	routes = [
		[/^GET .*\/contents\/\.recoder\/REVIEW\.md\?ref=main$/, () => ({ body: { type: 'file', content: Buffer.from('## Focus\n- X').toString('base64') } })],
		[/^GET .*\/pulls\?state=open/, () => ({ body: [{ number: 3, html_url: 'h', head: { ref: 'feature' } }, { number: 9, html_url: 'g', head: { ref: 'recoder/review-guidelines-1' } }] })]
	];
	const host = repoFileHost(repo('https://github.com/o/r', 'github'));
	expect(host.canWrite()).toBe(false);
	expect(await host.readFile('.recoder/REVIEW.md', 'main')).toEqual({ content: '## Focus\n- X' });
	expect(await host.readFile('missing.md', 'main')).toBeNull();
	expect(await host.findPending('recoder/review-guidelines-')).toEqual({ number: 9, url: 'g', branch: 'recoder/review-guidelines-1' });
});

test('GitLab: commits with a create action on a new branch and opens a merge request on the repo host', async () => {
	setToken('gitlab', 'gl');
	routes = [
		[/^GET https:\/\/git\.example\.com\/api\/v4\/projects\/o%2Fr$/, () => ({ body: { default_branch: 'trunk' } })],
		[/^GET .*\/repository\/branches\/trunk$/, () => ({ body: { commit: { id: 'c1' } } })],
		[/^POST .*\/repository\/commits$/, () => ({ status: 201, body: {} })],
		[/^POST .*\/merge_requests$/, () => ({ status: 201, body: { iid: 4, web_url: 'https://git.example.com/o/r/-/merge_requests/4' } })]
	];
	const result = await repoFileHost(repo('https://git.example.com/o/r.git', 'gitlab')).propose({ path: '.recoder/REVIEW.md', content: 'x', branch: 'b', title: 'T', body: 'B', commitMessage: 'M', pending: null });
	expect(result).toEqual({ number: 4, url: 'https://git.example.com/o/r/-/merge_requests/4', branch: 'b' });
	const commit = calls.find((call) => call.url.endsWith('/repository/commits'))!;
	expect(commit.body).toEqual({ branch: 'b', start_branch: 'trunk', commit_message: 'M', actions: [{ action: 'create', file_path: '.recoder/REVIEW.md', content: 'x' }] });
	expect(calls.find((call) => call.url.endsWith('/merge_requests'))!.body).toMatchObject({ source_branch: 'b', target_branch: 'trunk' });
});
