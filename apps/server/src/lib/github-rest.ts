import { GhError } from './gh.js';
import { getToken } from './tokens.js';

const API = 'https://api.github.com/';

/** The connected GitHub token (UI or `GH_TOKEN`), else `GITHUB_TOKEN`. Public repos work without one. */
export function githubToken(): string | undefined {
	return getToken('github') || process.env.GITHUB_TOKEN || undefined;
}

/** Call a GitHub REST endpoint as JSON with the configured token, no `gh` CLI. Throws GhError. */
export async function githubRest(path: string, init?: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH'; body?: unknown }): Promise<unknown> {
	const token = githubToken();
	let response: Response;
	try {
		response = await fetch(API + path.replace(/^\/+/, ''), {
			method: init?.method ?? 'GET',
			body: init?.body === undefined ? undefined : JSON.stringify(init.body),
			headers: {
				...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				'User-Agent': 'recoder',
				...(token ? { Authorization: `Bearer ${token}` } : {})
			},
			signal: AbortSignal.timeout(15_000)
		});
	} catch (err) {
		throw new GhError('unavailable', `GitHub API unreachable: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (response.status === 204) return null;
	if (response.ok) return response.json();
	const body = await response.text().catch(() => '');
	const message = (() => {
		try { return (JSON.parse(body) as { message?: string }).message ?? body; } catch { return body; }
	})().slice(0, 500);
	if (response.status === 401) throw new GhError('auth', token ? 'GitHub rejected the API token. Update it in Settings → Connections.' : 'Add a GitHub API token in Settings → Connections.');
	if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
		throw new GhError('auth', token ? 'GitHub API rate limit reached. Try again shortly.' : 'GitHub API rate limit reached. Add a GitHub API token in Settings → Connections.');
	}
	if (response.status === 403 && init?.method && init.method !== 'GET') {
		throw new GhError('auth', token ? `GitHub refused the change: ${message || 'the token needs write access to this repository'}` : 'Add a GitHub API token with write access in Settings → Connections.');
	}
	if (response.status === 404) throw new GhError('not-found', token ? message || 'Not found on GitHub.' : 'Not found. Private repositories need a GitHub API token.');
	throw new GhError('unknown', `GitHub API ${response.status}: ${message}`);
}

/** A pull request's head branch and commit. */
export async function fetchPullHead(slug: string, prNumber: number): Promise<{ ref: string; sha: string }> {
	const pull = await githubRest(`repos/${slug}/pulls/${prNumber}`) as { head?: { ref?: string; sha?: string } };
	const ref = pull.head?.ref ?? '';
	const sha = pull.head?.sha ?? '';
	if (!sha) throw new GhError('unknown', 'PR has no head commit');
	return { ref: ref || sha, sha };
}
