import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GhError } from '../../src/forge/gh';
import { fetchPullHead, githubRest } from '../../src/forge/github-rest';
import { setToken } from '../../src/forge/tokens';

const realFetch = globalThis.fetch;
const env = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
let calls: { url: string; headers: Record<string, string> }[] = [];

function respond(status: number, body: unknown, headers: Record<string, string> = {}): void {
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		calls.push({ url, headers: init?.headers as Record<string, string> });

		return new Response(JSON.stringify(body), { status, headers });
	}) as typeof fetch;
}

/** The kind of GhError a read of `repos/o/r` fails with. */
async function failedKind(): Promise<string> {
	const error = await githubRest('repos/o/r').catch((err: unknown) => err);

	expect(error).toBeInstanceOf(GhError);

	return (error as GhError).kind;
}

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-gh-rest-'));
	delete process.env.GH_TOKEN;
	delete process.env.GITHUB_TOKEN;
	calls = [];
});

afterEach(() => {
	globalThis.fetch = realFetch;
	for (const [key, value] of Object.entries(env))
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
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
	expect(await failedKind()).toBe('auth');
});

test('maps a rate limit to its own kind, never to a rejected token', async () => {
	setToken('github', 'fine');

	const limits: [number, unknown, Record<string, string>][] = [
		[403, { message: 'API rate limit exceeded for user ID 1.' }, { 'x-ratelimit-remaining': '0' }],
		[403, { message: 'You have exceeded a secondary rate limit.' }, {}],
		[429, { message: 'Too many requests' }, { 'retry-after': '60' }]
	];

	for (const [status, body, headers] of limits) {
		respond(status, body, headers);
		expect(await failedKind()).toBe('rate-limit');
	}
});

test('fails as a GhError when a 2xx body is not JSON', async () => {
	globalThis.fetch = (async () => new Response('<html>busy</html>', { status: 200 })) as unknown as typeof fetch;
	expect(await failedKind()).toBe('unknown');
});

test('reads the pull request head branch and commit', async () => {
	respond(200, { head: { ref: 'feature', sha: 'abc123' } });
	expect(await fetchPullHead('o/r', 7)).toEqual({ ref: 'feature', sha: 'abc123' });
	expect(calls[0].url).toBe('https://api.github.com/repos/o/r/pulls/7');
});
