import type { PullFile, PullRequest, RemoteRepo } from '@recoder/shared';
import { runCommand } from '../commands/runner.js';

export type GhErrorKind = 'unavailable' | 'auth' | 'not-found' | 'unknown';

export class GhError extends Error {
	kind: GhErrorKind;

	constructor(kind: GhErrorKind, message: string) {
		super(message);
		this.kind = kind;
	}
}

/** `https://github.com/o/r(.git)`, `git@github.com:o/r(.git)`, or bare `o/r` → `o/r`. */
export function parseRepoSlug(url: string): string {
	const clean = url.trim().replace(/\.git$/, '');
	const m = /github\.com[/:]([^/\s]+\/[^/\s]+)\/?$/.exec(clean);
	if (m) return m[1];
	if (/^[^/\s]+\/[^/\s]+$/.test(clean)) return clean;
	throw new GhError('unknown', `cannot parse repo slug from ${url}`);
}

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
	if (
		text.includes('not found') ||
		text.includes('no pull requests') ||
		text.includes('could not resolve')
	) {
		return new GhError('not-found', logs.slice(-500));
	}
	return new GhError('unknown', logs.slice(-2000));
}

export function extractJson(logs: string): unknown {
	const objStart = logs.indexOf('{');
	const arrStart = logs.indexOf('[');
	let start = -1;
	let end = -1;
	if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
		start = objStart;
		end = logs.lastIndexOf('}');
	} else if (arrStart !== -1) {
		start = arrStart;
		end = logs.lastIndexOf(']');
	}
	if (start === -1 || end <= start) {
		throw new GhError('unknown', `gh returned non-JSON: ${logs.slice(-500)}`);
	}
	try {
		return JSON.parse(logs.slice(start, end + 1));
	} catch {
		throw new GhError('unknown', `gh returned invalid JSON: ${logs.slice(-500)}`);
	}
}

/** Run `gh`, capturing stdout. Never throws raw — always GhError. */
async function gh(args: string[], env?: Record<string, string>): Promise<string> {
	let run;
	try {
		run = await runCommand({ label: `gh ${args.slice(0, 2).join(' ')}`, command: 'gh', args, env });
	} catch (err) {
		throw new GhError('unavailable', err instanceof Error ? err.message : String(err));
	}
	if (run.status !== 'succeeded') throw classifyFailure(run.logs);
	return run.logs;
}

export interface FetchedPull {
	pr: PullRequest;
	/** Raw unified diff (`gh pr diff`). */
	diff: string;
}

/** Preview file statistics without requesting GitHub's size-limited diff. */
export async function listPullFiles(repoUrl: string, prNumber: number, env?: Record<string, string>): Promise<PullFile[]> {
	const slug = parseRepoSlug(repoUrl);
	const files: PullFile[] = [];
	for (let page = 1; ; page++) {
		const rows = extractJson(await gh(['api', 'repos/' + slug + '/pulls/' + prNumber + '/files?per_page=100&page=' + page], env));
		if (!Array.isArray(rows)) throw new GhError('unknown', 'gh returned non-array files');
		for (const row of rows) {
			files.push({ path: row.filename, additions: row.additions, deletions: row.deletions });
		}
		if (rows.length < 100) break;
	}
	return files;
}

/** Is the gh binary usable at all? */
export async function ghAvailable(): Promise<boolean> {
	try {
		const run = await runCommand({ label: 'gh version', command: 'gh', args: ['--version'] });
		return run.status === 'succeeded';
	} catch {
		return false;
	}
}

/** Authenticated user (if any). Never throws. */
export async function ghAuth(env?: Record<string, string>): Promise<{ authenticated: boolean; user: string | null }> {
	try {
		const run = await runCommand({
			label: 'gh auth',
			command: 'gh',
			args: ['api', 'user', '--jq', '.login'],
			env
		});
		if (run.status !== 'succeeded') return { authenticated: false, user: null };
		const user = run.logs.trim();
		return { authenticated: true, user: user === '' ? null : user };
	} catch {
		return { authenticated: false, user: null };
	}
}

/** User's repos (newest activity first). Throws GhError. */
export async function listGhRepos(env?: Record<string, string>): Promise<RemoteRepo[]> {
	let run;
	try {
		run = await runCommand({
			label: 'gh repo list',
			command: 'gh',
			args: ['repo', 'list', '--limit', '50', '--json', 'nameWithOwner,url,isPrivate,updatedAt'],
			env
		});
	} catch (err) {
		throw new GhError('unavailable', err instanceof Error ? err.message : String(err));
	}
	if (run.status !== 'succeeded') throw classifyFailure(run.logs);
	const items = extractJson(run.logs);
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

/** Head branch name for a PR (no diff fetch). Throws GhError. */
export async function fetchPullHeadRef(
	repoUrl: string,
	prNumber: number,
	opts?: { env?: Record<string, string> }
): Promise<string> {
	const slug = parseRepoSlug(repoUrl);
	const view = (await gh(
		['pr', 'view', String(prNumber), '--repo', slug, '--json', 'headRefName'],
		opts?.env
	).then(extractJson)) as Record<string, unknown>;
	const headRef = typeof view.headRefName === 'string' ? view.headRefName : '';
	if (!headRef) throw new GhError('unknown', 'PR has no head ref');
	return headRef;
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
			'number,title,url,author,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,createdAt,body'
		],
		opts?.env
	).then(extractJson)) as unknown;
	if (!Array.isArray(rows)) throw new GhError('unknown', 'gh pr list returned non-array JSON');
	return rows.flatMap((row) =>
		typeof row === 'object' && row !== null
			? [parsePullRow(row as Record<string, unknown>, 0)]
			: []
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
		body: typeof view.body === 'string' ? view.body : ''
	};
}
