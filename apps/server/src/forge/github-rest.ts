import { GhError, GITHUB_RATE_LIMIT, githubRateLimit } from './cli.js';
import { getToken } from './tokens.js';

const API = 'https://api.github.com/';

/** The connected GitHub token (UI or `GH_TOKEN`), else `GITHUB_TOKEN`. Public repos work without one. */
export function githubToken(): string | undefined {
	return getToken('github') || process.env.GITHUB_TOKEN || undefined;
}

/** The request's own time limit, ended early when the caller's signal aborts. */
export function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
	return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}

/**
 * A request or body read that failed before GitHub's answer arrived whole,
 * in plain words: past the time limit, or else `otherwise` (offline, or the
 * connection dropped). The runtime's own text never reaches the page, and
 * no sentence says "didn’t" or "couldn’t", which the app's notice titles
 * already say ("The checks didn’t load.").
 */
function unreachable(err: unknown, otherwise: string): GhError {
	const timedOut = (err as { name?: unknown } | null)?.name === 'TimeoutError';

	return new GhError('unavailable', timedOut ? 'GitHub took too long to answer.' : otherwise);
}

/**
 * A 2xx answer's JSON. A body cut off on the way fails like the request
 * would, and one that is empty or not JSON is an `unknown` GhError, never a
 * raw parse error, so a route still answers with its reason.
 */
async function okBody(response: Response): Promise<unknown> {
	let text: string;

	try {
		text = await response.text();
	} catch (err) {
		throw unreachable(err, 'GitHub’s answer was cut off.');
	}

	try {
		return JSON.parse(text);
	} catch {
		throw new GhError('unknown', 'GitHub’s answer wasn’t readable.');
	}
}

/**
 * GitHub's primary and secondary rate limits: a 429, or a 403 with no
 * requests left, a wait to observe, or GitHub's own words for it.
 */
function rateLimited(response: Response, message: string): boolean {
	if (response.status === 429) return true;

	return (
		response.status === 403 &&
		(response.headers.get('x-ratelimit-remaining') === '0' ||
			response.headers.has('retry-after') ||
			GITHUB_RATE_LIMIT.test(message))
	);
}

/** Call a GitHub REST endpoint as JSON with the configured token, no `gh` CLI. Throws GhError. */
export async function githubRest(
	path: string,
	init?: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH'; body?: unknown; signal?: AbortSignal }
): Promise<unknown> {
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
			signal: withTimeout(15_000, init?.signal)
		});
	} catch (err) {
		throw unreachable(err, 'No connection to GitHub.');
	}

	if (response.status === 204) return null;
	if (response.ok) return okBody(response);

	const body = await response.text().catch(() => '');

	const message = (() => {
		try {
			return (JSON.parse(body) as { message?: string }).message ?? body;
		} catch {
			return body;
		}
	})().slice(0, 500);

	if (response.status === 401)
		throw new GhError(
			'auth',
			token
				? 'GitHub rejected the API token. Update it in Settings → Connections.'
				: 'Add a GitHub API token in Settings → Connections.'
		);

	if (rateLimited(response, message)) throw githubRateLimit(!!token);

	if (response.status === 403 && init?.method && init.method !== 'GET') {
		throw new GhError(
			'auth',
			token
				? `GitHub refused the change: ${message || 'the token needs write access to this repository'}`
				: 'Add a GitHub API token with write access in Settings → Connections.'
		);
	}

	if (response.status === 404)
		throw new GhError(
			'not-found',
			token ? message || 'Not found on GitHub.' : 'Not found. Private repositories need a GitHub API token.'
		);
	throw new GhError('unknown', `GitHub API ${response.status}: ${message}`);
}

/** A pull request's head branch and commit. */
export async function fetchPullHead(slug: string, prNumber: number): Promise<{ ref: string; sha: string }> {
	const pull = (await githubRest(`repos/${slug}/pulls/${prNumber}`)) as {
		head?: { ref?: string; sha?: string };
	} | null;

	const ref = pull?.head?.ref ?? '';
	const sha = pull?.head?.sha ?? '';

	if (!sha) throw new GhError('unknown', 'GitHub named no head commit for the pull request.');

	return { ref: ref || sha, sha };
}
