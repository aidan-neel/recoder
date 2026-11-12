import type { PrPerson, PullFile, PullRequest, RemoteRepo } from '@recoder/shared';
import {
	extractJson,
	forgeCliAvailable,
	forgeCliUser,
	GhError,
	GITHUB_RATE_LIMIT,
	githubRateLimit,
	isJsonObject,
	runForgeCli
} from './cli.js';
import { withoutCredentials } from '../cli/target/redact.js';

export { extractJson, GhError } from './cli.js';

/** `https://github.com/o/r(.git)`, `git@github.com:o/r(.git)`, or bare `o/r` → `o/r`. */
export function parseRepoSlug(url: string): string {
	const clean = url.trim().replace(/\.git$/, '');
	const m = /github\.com[/:]([^/\s]+\/[^/\s]+)\/?$/.exec(clean);

	if (m) return m[1];
	if (/^[^/\s]+\/[^/\s]+$/.test(clean)) return clean;
	throw new GhError('unknown', `cannot parse repo slug from ${withoutCredentials(url)}`);
}

/**
 * A failed `gh` run's logs as an auth, rate-limit, not-found or unknown
 * GhError. `gh` only calls GitHub signed in, so a rate limit it meets is the
 * signed-in limit, which a token in Connections would not raise.
 */
function classifyFailure(logs: string): GhError {
	const text = logs.toLowerCase();

	if (
		text.includes('not authenticated') ||
		text.includes('authentication required') ||
		text.includes('bad credentials') ||
		text.includes('not logged into') ||
		text.includes('gh auth login') ||
		text.includes('gh_token') ||
		text.includes('gh token')
	) {
		return new GhError('auth', `gh not authenticated: ${logs.slice(-500)}`);
	}

	if (GITHUB_RATE_LIMIT.test(logs)) return githubRateLimit(true);

	if (text.includes('not found') || text.includes('no pull requests') || text.includes('could not resolve')) {
		return new GhError('not-found', logs.slice(-500));
	}

	return new GhError('unknown', logs.slice(-2000));
}

/** Run `gh`, capturing stdout. Never throws raw — always GhError. */
export function gh(args: string[], env?: Record<string, string>): Promise<string> {
	return runForgeCli('gh', args, env, classifyFailure);
}

export interface FetchedPull {
	pr: PullRequest;
	/** Raw unified diff (`gh pr diff`). */
	diff: string;
}

/** Preview file statistics without requesting GitHub's size-limited diff. */
export async function listPullFiles(
	repoUrl: string,
	prNumber: number,
	env?: Record<string, string>
): Promise<PullFile[]> {
	const slug = parseRepoSlug(repoUrl);
	const files: PullFile[] = [];

	for (let page = 1; ; page++) {
		const rows = extractJson(
			await gh(['api', 'repos/' + slug + '/pulls/' + prNumber + '/files?per_page=100&page=' + page], env)
		);

		if (!Array.isArray(rows)) throw new GhError('unknown', 'gh returned non-array files');

		for (const row of rows) {
			files.push({ path: row.filename, additions: row.additions, deletions: row.deletions });
		}

		if (rows.length < 100) break;
	}

	return files;
}

/** Is the gh binary usable at all? */
export function ghAvailable(): Promise<boolean> {
	return forgeCliAvailable('gh');
}

/** Authenticated user (if any). Never throws. */
export function ghAuth(env?: Record<string, string>): Promise<{ authenticated: boolean; user: string | null }> {
	return forgeCliUser('gh', '.login', env);
}

/** User's repos (newest activity first). Throws GhError. */
export async function listGhRepos(env?: Record<string, string>): Promise<RemoteRepo[]> {
	const logs = await gh(['repo', 'list', '--limit', '50', '--json', 'nameWithOwner,url,isPrivate,updatedAt'], env);

	const items = extractJson(logs);

	if (!Array.isArray(items)) throw new GhError('unknown', 'gh repo list returned non-array JSON');

	return items.flatMap((item) => {
		if (typeof item !== 'object' || item === null) return [];

		const row = item as Record<string, unknown>;

		if (typeof row.nameWithOwner !== 'string' || typeof row.url !== 'string') return [];

		return [
			{
				name: row.nameWithOwner,
				url: row.url,
				provider: 'github' as const,
				isPrivate: row.isPrivate === true
			}
		];
	});
}

/** The `gh pr view` fields every pull request read asks for. */
const VIEW_FIELDS = [
	'number',
	'title',
	'url',
	'author',
	'baseRefName',
	'headRefName',
	'headRefOid',
	'additions',
	'deletions',
	'changedFiles',
	'createdAt',
	'body'
];

/** A pull request with the JSON row `gh` printed for it, so a caller that asked for more fields can read them. */
export interface PullRow {
	pr: PullRequest;
	row: Record<string, unknown>;
}

/** PR metadata + unified diff via the gh CLI. Throws GhError. */
export async function fetchPullRequest(
	repoUrl: string,
	prNumber: number,
	opts?: { env?: Record<string, string>; metadataOnly?: boolean }
): Promise<FetchedPull> {
	const { pr } = await viewPullRow(repoUrl, prNumber, { env: opts?.env });

	const diff = opts?.metadataOnly
		? ''
		: await gh(['pr', 'diff', String(prNumber), '--repo', parseRepoSlug(repoUrl)], opts?.env);

	return { pr, diff };
}

/** One pull request in any state with `fields` beyond the usual metadata. Throws GhError. */
export async function viewPullRow(
	repoUrl: string,
	prNumber: number,
	opts: { env?: Record<string, string>; fields?: string[] }
): Promise<PullRow> {
	const fields = [...VIEW_FIELDS, ...(opts.fields ?? [])].join(',');

	const row = extractJson(
		await gh(['pr', 'view', String(prNumber), '--repo', parseRepoSlug(repoUrl), '--json', fields], opts.env)
	);

	if (!isJsonObject(row)) throw new GhError('unknown', 'gh pr view returned non-object JSON');

	return { pr: parsePullRow(row, prNumber), row };
}

/** Open PRs for a repo, newest first. Throws GhError. */
export async function listPullRequests(
	repoUrl: string,
	opts?: { env?: Record<string, string>; limit?: number }
): Promise<PullRequest[]> {
	return (await listPullRows(repoUrl, opts ?? {})).map((row) => row.pr);
}

/**
 * Open PRs for a repo, newest first, in one `gh pr list` call with `fields`
 * beyond the usual metadata; `gh` reads as many pages as `limit` needs. Throws GhError.
 */
export async function listPullRows(
	repoUrl: string,
	opts: { env?: Record<string, string>; limit?: number; fields?: string[] }
): Promise<PullRow[]> {
	const fields = [...VIEW_FIELDS, 'assignees', ...(opts.fields ?? [])].join(',');

	const rows = extractJson(
		await gh(
			[
				'pr',
				'list',
				'--repo',
				parseRepoSlug(repoUrl),
				'--state',
				'open',
				'--limit',
				String(opts.limit ?? 20),
				'--json',
				fields
			],
			opts.env
		)
	);

	if (!Array.isArray(rows)) throw new GhError('unknown', 'gh pr list returned non-array JSON');

	return rows.filter(isJsonObject).map((row) => ({ pr: parsePullRow(row, 0), row }));
}

/** Normalize one `gh pr view`/`pr list` JSON row to a PullRequest. */
function parsePullRow(view: Record<string, unknown>, fallbackNumber: number): PullRequest {
	const author =
		typeof view.author === 'object' && view.author !== null
			? String((view.author as Record<string, unknown>).login ?? 'unknown')
			: 'unknown';

	return {
		number: Number(view.number ?? fallbackNumber),
		title: String(view.title ?? ''),
		url: String(view.url ?? ''),
		author,
		base: String(view.baseRefName ?? ''),
		headRef: String(view.headRefName ?? ''),
		headSha: String(view.headRefOid ?? 'unknown'),
		additions: Number(view.additions ?? 0),
		deletions: Number(view.deletions ?? 0),
		changedFiles: Number(view.changedFiles ?? 0),
		createdAt: typeof view.createdAt === 'string' ? view.createdAt : '',
		body: typeof view.body === 'string' ? view.body : '',
		...(Array.isArray(view.assignees) ? { assignees: githubPeople(view.assignees) } : {})
	};
}

/** `gh` gives logins without avatars; github.com/<login>.png is the public avatar. */
function githubPeople(rows: unknown[]): PrPerson[] {
	return rows.flatMap((row) => {
		const person = row as { login?: unknown; name?: unknown } | null;

		if (typeof person?.login !== 'string') return [];

		return [
			{
				login: person.login,
				name: typeof person.name === 'string' && person.name ? person.name : null,
				avatarUrl: `https://github.com/${encodeURIComponent(person.login)}.png?size=64`
			}
		];
	});
}
