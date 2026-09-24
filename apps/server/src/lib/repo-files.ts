import type { Repo } from '@recoder/shared';
import { GhError } from './gh.js';
import { githubRest, githubToken } from './github-rest.js';
import { detectProvider, parseSlug } from './providers.js';
import { getToken } from './tokens.js';

/**
 * Read and propose single repository files through the provider's REST API
 * with the connected token (no clone, no CLI). Used for `.recoder/REVIEW.md`.
 * Proposals always go through a branch plus pull/merge request, never a direct
 * push to the default branch.
 */

export interface RepoFile {
	content: string;
}

export interface PendingChange {
	number: number;
	url: string;
	branch: string;
}

export interface ProposeInput {
	path: string;
	content: string;
	/** New branch name when there is no pending change to update. */
	branch: string;
	title: string;
	body: string;
	commitMessage: string;
	/** Push to this pending change's branch instead of opening a new one. */
	pending: PendingChange | null;
}

export interface RepoFileHost {
	canWrite(): boolean;
	defaultBranch(): Promise<{ branch: string; sha: string }>;
	readFile(path: string, ref: string): Promise<RepoFile | null>;
	/** An open pull/merge request from a branch starting with `prefix` into the default branch. */
	findPending(prefix: string): Promise<PendingChange | null>;
	propose(input: ProposeInput): Promise<PendingChange>;
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const fromBase64 = (text: string) => Buffer.from(text.replace(/\n/g, ''), 'base64').toString('utf8');

async function orNull<T>(run: () => Promise<T>): Promise<T | null> {
	try {
		return await run();
	} catch (err) {
		if (err instanceof GhError && err.kind === 'not-found') return null;
		throw err;
	}
}

function githubHost(repo: Repo): RepoFileHost {
	const slug = parseSlug(repo.url);
	const self: RepoFileHost = {
		canWrite: () => !!githubToken(),
		async defaultBranch() {
			const info = await githubRest(`repos/${slug}`) as { default_branch?: string };
			const branch = info.default_branch || repo.defaultBranch || 'main';
			const head = await githubRest(`repos/${slug}/branches/${encodeURIComponent(branch)}`) as { commit?: { sha?: string } };
			return { branch, sha: head.commit?.sha ?? '' };
		},
		async readFile(path, ref) {
			const file = await orNull(() => githubRest(`repos/${slug}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`) as Promise<{ content?: string; type?: string }>);
			if (!file || file.type !== 'file' || typeof file.content !== 'string') return null;
			return { content: fromBase64(file.content) };
		},
		async findPending(prefix) {
			const pulls = await githubRest(`repos/${slug}/pulls?state=open&per_page=100`) as { number: number; html_url: string; head: { ref: string } }[];
			const match = pulls.find((pull) => pull.head.ref.startsWith(prefix));
			return match ? { number: match.number, url: match.html_url, branch: match.head.ref } : null;
		},
		async propose(input) {
			const { branch: target, sha } = await self.defaultBranch();
			const branch = input.pending?.branch ?? input.branch;
			if (!input.pending) {
				await githubRest(`repos/${slug}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha } });
			}
			// The contents API needs the file's blob sha on that branch when it already exists.
			const existing = await orNull(() => githubRest(`repos/${slug}/contents/${encodePath(input.path)}?ref=${encodeURIComponent(branch)}`) as Promise<{ sha?: string }>);
			await githubRest(`repos/${slug}/contents/${encodePath(input.path)}`, {
				method: 'PUT',
				body: { message: input.commitMessage, content: base64(input.content), branch, ...(existing?.sha ? { sha: existing.sha } : {}) }
			});
			if (input.pending) return input.pending;
			const pull = await githubRest(`repos/${slug}/pulls`, {
				method: 'POST',
				body: { title: input.title, head: branch, base: target, body: input.body }
			}) as { number: number; html_url: string };
			return { number: pull.number, url: pull.html_url, branch };
		}
	};
	return self;
}

/** GitLab REST v4 on the repo's own host (gitlab.com or self-managed). */
function gitlabApiBase(url: string): string {
	const clean = url.trim();
	const host = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)/i.exec(clean)?.[1] ?? /^[^@]+@([^:]+):/.exec(clean)?.[1] ?? 'gitlab.com';
	return `https://${host}/api/v4/`;
}

async function gitlabRest(apiBase: string, path: string, init?: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown }): Promise<unknown> {
	const token = getToken('gitlab');
	let response: Response;
	try {
		response = await fetch(apiBase + path, {
			method: init?.method ?? 'GET',
			body: init?.body === undefined ? undefined : JSON.stringify(init.body),
			headers: {
				...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
				...(token ? { 'PRIVATE-TOKEN': token } : {})
			},
			signal: AbortSignal.timeout(15_000)
		});
	} catch (err) {
		throw new GhError('unavailable', `GitLab API unreachable: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (response.ok) return response.status === 204 ? null : response.json();
	const text = await response.text().catch(() => '');
	const message = (() => {
		try {
			const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
			return String(parsed.message ?? parsed.error ?? text);
		} catch { return text; }
	})().slice(0, 500);
	if (response.status === 401) throw new GhError('auth', token ? 'GitLab rejected the API token. Update it in Settings → Connections.' : 'Add a GitLab API token in Settings → Connections.');
	if (response.status === 403) throw new GhError('auth', `GitLab refused the request: ${message || 'the token needs write access to this project'}`);
	if (response.status === 404) throw new GhError('not-found', token ? message || 'Not found on GitLab.' : 'Not found. Private projects need a GitLab API token.');
	throw new GhError('unknown', `GitLab API ${response.status}: ${message}`);
}

function gitlabHost(repo: Repo): RepoFileHost {
	const api = gitlabApiBase(repo.url);
	const project = `projects/${encodeURIComponent(parseSlug(repo.url))}`;
	const call = (path: string, init?: Parameters<typeof gitlabRest>[2]) => gitlabRest(api, `${project}${path}`, init);
	const self: RepoFileHost = {
		canWrite: () => !!getToken('gitlab'),
		async defaultBranch() {
			const info = await call('') as { default_branch?: string };
			const branch = info.default_branch || repo.defaultBranch || 'main';
			const head = await call(`/repository/branches/${encodeURIComponent(branch)}`) as { commit?: { id?: string } };
			return { branch, sha: head.commit?.id ?? '' };
		},
		async readFile(path, ref) {
			const file = await orNull(() => call(`/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`) as Promise<{ content?: string }>);
			return typeof file?.content === 'string' ? { content: fromBase64(file.content) } : null;
		},
		async findPending(prefix) {
			const requests = await call('/merge_requests?state=opened&per_page=100') as { iid: number; web_url: string; source_branch: string }[];
			const match = requests.find((request) => request.source_branch.startsWith(prefix));
			return match ? { number: match.iid, url: match.web_url, branch: match.source_branch } : null;
		},
		async propose(input) {
			const { branch: target } = await self.defaultBranch();
			const branch = input.pending?.branch ?? input.branch;
			const exists = !!(await self.readFile(input.path, input.pending ? branch : target));
			await call('/repository/commits', {
				method: 'POST',
				body: {
					branch,
					...(input.pending ? {} : { start_branch: target }),
					commit_message: input.commitMessage,
					actions: [{ action: exists ? 'update' : 'create', file_path: input.path, content: input.content }]
				}
			});
			if (input.pending) return input.pending;
			const request = await call('/merge_requests', {
				method: 'POST',
				body: { source_branch: branch, target_branch: target, title: input.title, description: input.body, remove_source_branch: true }
			}) as { iid: number; web_url: string };
			return { number: request.iid, url: request.web_url, branch };
		}
	};
	return self;
}

export function repoFileHost(repo: Repo): RepoFileHost {
	return (repo.provider ?? detectProvider(repo.url)) === 'gitlab' ? gitlabHost(repo) : githubHost(repo);
}
