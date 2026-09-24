import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GhError } from './gh';
import { fetchPullHead, githubRest } from './github-rest';
import { setToken } from './tokens';

const realFetch = globalThis.fetch;
const env = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
let calls: { url: string; headers: Record<string, string> }[] = [];

function respond(status: number, body: unknown, headers: Record<string, string> = {}): void {
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		calls.push({ url, headers: init?.headers as Record<string, string> });
		return new Response(JSON.stringify(body), { status, headers });
	}) as typeof fetch;
}

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-gh-rest-'));
	delete process.env.GH_TOKEN;
	delete process.env.GITHUB_TOKEN;
	calls = [];
});
afterEach(() => {
	globalThis.fetch = realFetch;
	for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
});

test('sends the saved GitHub token as a bearer token', async () => {
	setToken('github', 'saved-token');
	respond(200, { ok: true });
	expect(await githubRest('repos/o/r')).toEqual({ ok: true });
	expect(calls[0].url).toBe('https://api.github.com/repos/o/r');
	expect(calls[0].headers.Authorization).toBe('Bearer saved-token');
});

test('falls back to GITHUB_TOKEN and works without any token', async () => {
	process.env.GITHUB_TOKEN = 'env-token';
	respond(200, {});
	await githubRest('rate_limit');
	expect(calls[0].headers.Authorization).toBe('Bearer env-token');
	delete process.env.GITHUB_TOKEN;
	await githubRest('rate_limit');
	expect(calls[1].headers.Authorization).toBeUndefined();
});

test('maps a rejected token to an auth error', async () => {
	setToken('github', 'bad');
	respond(401, { message: 'Bad credentials' });
	const error = await githubRest('repos/o/r').catch((err) => err);
	expect(error).toBeInstanceOf(GhError);
	expect((error as GhError).kind).toBe('auth');
});

test('reads the pull request head branch and commit', async () => {
	respond(200, { head: { ref: 'feature', sha: 'abc123' } });
	expect(await fetchPullHead('o/r', 7)).toEqual({ ref: 'feature', sha: 'abc123' });
	expect(calls[0].url).toBe('https://api.github.com/repos/o/r/pulls/7');
});
