import type { PrPerson, PullFile, PullRequest, RemoteRepo } from '@recoder/shared';
import { extractJson, forgeCliAvailable, forgeCliUser, GhError, runForgeCli } from './cli.js';

export { extractJson, GhError } from './cli.js';

/** `https://github.com/o/r(.git)`, `git@github.com:o/r(.git)`, or bare `o/r` → `o/r`. */
export function parseRepoSlug(url: string): string {
	const clean = url.trim().replace(/\.git$/, '');
	const m = /github\.com[/:]([^/\s]+\/[^/\s]+)\/?$/.exec(clean);

	if (m) return m[1];
	if (/^[^/\s]+\/[^/\s]+$/.test(clean)) return clean;
	throw new GhError('unknown', `cannot parse repo slug from ${url}`);
}

/** A failed `gh` run's logs as an auth, not-found or unknown GhError. */
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

	if (text.includes('not found') || text.includes('no pull requests') || text.includes('could not resolve')) {
		return new GhError('not-found', logs.slice(-500));
	}

	return new GhError('unknown', logs.slice(-2000));
}

/** Run `gh`, capturing stdout. Never throws raw — always GhError. */
function gh(args: string[], env?: Record<string, string>): Promise<string> {
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

/** PR metadata + unified diff via the gh CLI. Throws GhError. */
export async function fetchPullRequest(
	repoUrl: string,
	prNumber: number,
	opts?: { env?: Record<string, string>; metadataOnly?: boolean }
): Promise<FetchedPull> {
	const slug = parseRepoSlug(repoUrl);

	const view = (await gh(
		[
			'pr',
			'view',
			String(prNumber),
			'--repo',
			slug,
			'--json',
			'number,title,url,author,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,createdAt,body'
		],
		opts?.env
	).then(extractJson)) as Record<string, unknown>;

	const diff = opts?.metadataOnly ? '' : await gh(['pr', 'diff', String(prNumber), '--repo', slug], opts?.env);

	return { pr: parsePullRow(view, prNumber), diff };
}

/** Open PRs for a repo, newest first. Throws GhError. */
export async function listPullRequests(
	repoUrl: string,
	opts?: { env?: Record<string, string>; limit?: number }
): Promise<PullRequest[]> {
	const slug = parseRepoSlug(repoUrl);

	const rows = (await gh(
		[
			'pr',
			'list',
			'--repo',
			slug,
			'--state',
			'open',
			'--limit',
			String(opts?.limit ?? 20),
			'--json',
			'number,title,url,author,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,createdAt,body,assignees'
		],
		opts?.env
	).then(extractJson)) as unknown;

	if (!Array.isArray(rows)) throw new GhError('unknown', 'gh pr list returned non-array JSON');

	return rows.flatMap((row) =>
		typeof row === 'object' && row !== null ? [parsePullRow(row as Record<string, unknown>, 0)] : []
	);
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
