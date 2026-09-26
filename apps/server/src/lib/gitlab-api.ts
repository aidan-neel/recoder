import type { PrPerson, PullRequest, RemoteRepo } from '@recoder/shared';
import { GhError } from './gh.js';
import { parseSlug } from './providers.js';

/**
 * GitLab REST v4, used whenever a token is connected so the `glab` CLI is
 * optional. Host and token come from the same env `tokenEnv('gitlab')` builds
 * for glab (`GITLAB_HOST`, `GITLAB_TOKEN`).
 */

/** API when a token is connected, or when `glab` isn't installed (public projects need no token). */
export function useGitlabApi(env?: Record<string, string>): boolean {
	return !!env?.GITLAB_TOKEN || !Bun.which('glab', env?.PATH ? { PATH: env.PATH } : undefined);
}

function base(env: Record<string, string>): string {
	return `https://${env.GITLAB_HOST || 'gitlab.com'}/api/v4/`;
}

/** Network errors keep their cause: a self-managed host often fails on DNS or TLS. */
export async function gitlabGet(path: string, env: Record<string, string>, asText = false): Promise<unknown> {
	const host = env.GITLAB_HOST || 'gitlab.com';
	let response: Response;
	try {
		response = await fetch(base(env) + path, {
			headers: { ...(env.GITLAB_TOKEN ? { 'PRIVATE-TOKEN': env.GITLAB_TOKEN } : {}), Accept: 'application/json' },
			signal: AbortSignal.timeout(20_000)
		});
	} catch (err) {
		const cause = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
		throw new GhError('unavailable', `Couldn't reach ${host}: ${cause}`);
	}
	if (response.ok) return asText ? response.text() : response.json();
	const text = await response.text().catch(() => '');
	if (response.status === 401 || response.status === 403) {
		throw new GhError('auth', `${host} rejected the token (${response.status}). It needs the read_api scope.`);
	}
	if (response.status === 404) throw new GhError('not-found', `${host}: ${path.split('?')[0]} not found`);
	throw new GhError('unknown', `${host} returned ${response.status}: ${text.slice(0, 500)}`);
}

function project(repoUrl: string): string {
	return `projects/${encodeURIComponent(parseSlug(repoUrl))}`;
}

export async function apiUser(env: Record<string, string>): Promise<string | null> {
	const user = (await gitlabGet('user', env)) as { username?: unknown };
	return typeof user.username === 'string' ? user.username : null;
}

export async function apiProjects(env: Record<string, string>): Promise<RemoteRepo[]> {
	const rows = (await gitlabGet('projects?membership=true&order_by=last_activity_at&simple=true&per_page=100', env)) as Record<string, unknown>[];
	return rows.flatMap((row) =>
		typeof row.path_with_namespace === 'string' && typeof row.web_url === 'string'
			? [{ name: row.path_with_namespace, url: row.web_url, provider: 'gitlab' as const, isPrivate: row.visibility !== 'public' }]
			: []
	);
}

interface DiffEntry {
	old_path: string;
	new_path: string;
	a_mode?: string;
	b_mode?: string;
	diff: string;
	new_file: boolean;
	renamed_file: boolean;
	deleted_file: boolean;
}

/** Per-file diffs; `/diffs` needs GitLab 15.7+, older instances only have `/changes`. */
async function mergeDiffs(repoUrl: string, iid: number, env: Record<string, string>): Promise<DiffEntry[]> {
	const path = `${project(repoUrl)}/merge_requests/${iid}`;
	try {
		const entries: DiffEntry[] = [];
		for (let page = 1; page <= 20; page++) {
			const rows = (await gitlabGet(`${path}/diffs?per_page=100&page=${page}`, env)) as DiffEntry[];
			entries.push(...rows);
			if (rows.length < 100) break;
		}
		return entries;
	} catch (err) {
		if (!(err instanceof GhError) || err.kind !== 'not-found') throw err;
		const legacy = (await gitlabGet(`${path}/changes`, env)) as { changes?: DiffEntry[] };
		return legacy.changes ?? [];
	}
}

/** GitLab's per-file hunks → one `git diff`-style unified diff. */
export function toUnifiedDiff(entries: DiffEntry[]): string {
	return entries
		.map((file) => {
			const lines = [`diff --git a/${file.old_path} b/${file.new_path}`];
			if (file.new_file) lines.push(`new file mode ${file.b_mode ?? '100644'}`);
			if (file.deleted_file) lines.push(`deleted file mode ${file.a_mode ?? '100644'}`);
			if (file.renamed_file) lines.push(`rename from ${file.old_path}`, `rename to ${file.new_path}`);
			if (file.diff) {
				lines.push(file.new_file ? '--- /dev/null' : `--- a/${file.old_path}`);
				lines.push(file.deleted_file ? '+++ /dev/null' : `+++ b/${file.new_path}`);
				lines.push(file.diff.replace(/\n$/, ''));
			}
			return lines.join('\n');
		})
		.join('\n');
}

function diffStats(entries: DiffEntry[]): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	for (const file of entries) {
		for (const line of file.diff.split('\n')) {
			if (line.startsWith('+')) additions++;
			else if (line.startsWith('-')) deletions++;
		}
	}
	return { additions, deletions };
}

/** GitLab user rows (`assignees`, `reviewers`) carry their own avatar URLs. */
export function gitlabPeople(value: unknown): PrPerson[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((row) => {
		const person = row as { username?: unknown; name?: unknown; avatar_url?: unknown } | null;
		if (typeof person?.username !== 'string') return [];
		return [{ login: person.username, name: typeof person.name === 'string' ? person.name : null, avatarUrl: typeof person.avatar_url === 'string' ? person.avatar_url : null }];
	});
}

function toPull(row: Record<string, unknown>): PullRequest {
	const author = typeof row.author === 'object' && row.author !== null ? String((row.author as Record<string, unknown>).username ?? 'unknown') : 'unknown';
	return {
		number: Number(row.iid ?? 0),
		title: String(row.title ?? ''),
		url: String(row.web_url ?? ''),
		author,
		base: String(row.target_branch ?? ''),
		headRef: String(row.source_branch ?? ''),
		headSha: typeof row.sha === 'string' ? row.sha : 'unknown',
		additions: 0,
		deletions: 0,
		changedFiles: Number.parseInt(String(row.changes_count ?? '0'), 10) || 0,
		createdAt: typeof row.created_at === 'string' ? row.created_at : '',
		body: typeof row.description === 'string' ? row.description : '',
		assignees: gitlabPeople(row.assignees)
	};
}

export async function apiMergeRequest(repoUrl: string, iid: number, env: Record<string, string>): Promise<{ pr: PullRequest; diff: string }> {
	const [row, entries] = await Promise.all([
		gitlabGet(`${project(repoUrl)}/merge_requests/${iid}`, env) as Promise<Record<string, unknown>>,
		mergeDiffs(repoUrl, iid, env)
	]);
	const pr = { ...toPull(row), ...diffStats(entries) };
	if (!pr.changedFiles) pr.changedFiles = entries.length;
	return { pr, diff: toUnifiedDiff(entries) };
}

export async function apiMergeHeadRef(repoUrl: string, iid: number, env: Record<string, string>): Promise<string> {
	const row = (await gitlabGet(`${project(repoUrl)}/merge_requests/${iid}`, env)) as { source_branch?: unknown };
	if (typeof row.source_branch !== 'string' || !row.source_branch) throw new GhError('unknown', 'MR has no source branch');
	return row.source_branch;
}

/** Open MRs, newest first; +/− come from each MR's diffs (zeroed if that fetch fails). */
export async function apiMergeRequests(repoUrl: string, env: Record<string, string>, limit = 20): Promise<PullRequest[]> {
	const rows = (await gitlabGet(`${project(repoUrl)}/merge_requests?state=opened&order_by=created_at&sort=desc&per_page=${limit}`, env)) as Record<string, unknown>[];
	const prs = rows.map(toPull).filter((pr) => pr.number > 0);
	await Promise.all(
		prs.map(async (pr) => {
			try {
				const entries = await mergeDiffs(repoUrl, pr.number, env);
				Object.assign(pr, diffStats(entries));
				pr.changedFiles = entries.length;
			} catch {
				/* keep zeroed stats for this MR */
			}
		})
	);
	return prs;
}
