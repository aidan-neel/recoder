import type { PullRequest, RemoteRepo } from '@recoder/shared';
import { runCommand } from '../commands/runner.js';
import { extractJson, GhError } from './gh.js';
import { apiMergeHeadRef, apiMergeRequest, apiMergeRequests, apiProjects, apiUser, gitlabGet, gitlabPeople, useGitlabApi } from './gitlab-api.js';
import { parseSlug } from './providers.js';

function classifyFailure(logs: string): GhError {
	const text = logs.toLowerCase();
	if (
		text.includes('401 unauthorized') ||
		text.includes('unauthorized') ||
		text.includes('private token') ||
		text.includes('no token') ||
		text.includes('authentication')
	) {
		return new GhError('auth', `glab not authenticated: ${logs.slice(-500)}`);
	}
	if (text.includes('404') || text.includes('not found')) {
		return new GhError('not-found', logs.slice(-500));
	}
	return new GhError('unknown', logs.slice(-2000));
}

/** Run `glab`, capturing stdout. Never throws raw — always GhError. */
/** `glab api <path>` parsed as JSON. */
export async function glabApi(path: string, env?: Record<string, string>): Promise<unknown> {
	if (useGitlabApi(env)) return gitlabGet(path, env!);
	return extractJson(await glab(['api', path], env));
}

/** A plain-text API response, e.g. a job log. */
export async function glabApiText(path: string, env?: Record<string, string>): Promise<string> {
	if (useGitlabApi(env)) return gitlabGet(path, env!, true) as Promise<string>;
	return glab(['api', path], env);
}

async function glab(args: string[], env?: Record<string, string>): Promise<string> {
	let run;
	try {
		run = await runCommand({ label: `glab ${args.slice(0, 2).join(' ')}`, command: 'glab', args, env });
	} catch (err) {
		throw new GhError('unavailable', err instanceof Error ? err.message : String(err));
	}
	if (run.status !== 'succeeded') throw classifyFailure(run.logs);
	return run.logs;
}

export interface FetchedMerge {
	pr: PullRequest;
	/** Raw unified diff (`glab mr diff --raw`). */
	diff: string;
}

/** Is the glab binary usable at all? */
export async function glabAvailable(): Promise<boolean> {
	try {
		const run = await runCommand({ label: 'glab version', command: 'glab', args: ['--version'] });
		return run.status === 'succeeded';
	} catch {
		return false;
	}
}

/** Authenticated user (if any). Never throws; `error` says why a token didn't work. */
export async function glabAuth(
	env?: Record<string, string>
): Promise<{ authenticated: boolean; user: string | null; error?: string }> {
	if (useGitlabApi(env)) {
		try {
			return { authenticated: true, user: await apiUser(env!) };
		} catch (err) {
			return { authenticated: false, user: null, error: err instanceof Error ? err.message : String(err) };
		}
	}
	try {
		const run = await runCommand({
			label: 'glab auth',
			command: 'glab',
			args: ['api', 'user', '--jq', '.username'],
			env
		});
		if (run.status !== 'succeeded') return { authenticated: false, user: null };
		const user = run.logs.trim();
		return { authenticated: true, user: user === '' ? null : user };
	} catch {
		return { authenticated: false, user: null };
	}
}

/** User's projects (recent activity first). Throws GhError. */
export async function listGlabRepos(env?: Record<string, string>): Promise<RemoteRepo[]> {
	if (useGitlabApi(env)) return apiProjects(env!);
	let run;
	try {
		run = await runCommand({
			label: 'glab repo list',
			command: 'glab',
			args: ['repo', 'list', '-F', 'json', '--per-page', '50'],
			env
		});
	} catch (err) {
		throw new GhError('unavailable', err instanceof Error ? err.message : String(err));
	}
	if (run.status !== 'succeeded') throw classifyFailure(run.logs);
	const items = extractJson(run.logs);
	if (!Array.isArray(items)) throw new GhError('unknown', 'glab repo list returned non-array JSON');
	return items.flatMap((item) => {
		if (typeof item !== 'object' || item === null) return [];
		const row = item as Record<string, unknown>;
		const name =
			typeof row.path_with_namespace === 'string'
				? row.path_with_namespace
				: typeof row.path === 'string'
					? row.path
					: null;
		if (!name || typeof row.web_url !== 'string') return [];
		return [
			{
				name,
				url: row.web_url,
				provider: 'gitlab' as const,
				isPrivate: row.visibility !== 'public'
			}
		];
	});
}

/** Source branch name for an MR (no diff fetch). Throws GhError. */
export async function fetchMergeHeadRef(
	repoUrl: string,
	iid: number,
	env?: Record<string, string>
): Promise<string> {
	if (useGitlabApi(env)) return apiMergeHeadRef(repoUrl, iid, env!);
	const slug = parseSlug(repoUrl);
	const view = (await glab(
		['mr', 'view', String(iid), '-R', slug, '-F', 'json'],
		env
	).then(extractJson)) as Record<string, unknown>;
	const headRef = typeof view.source_branch === 'string' ? view.source_branch : '';
	if (!headRef) throw new GhError('unknown', 'MR has no source branch');
	return headRef;
}

/** MR metadata + unified diff via the glab CLI. Throws GhError. */
export async function fetchMergeRequest(
	repoUrl: string,
	iid: number,
	opts?: { env?: Record<string, string> }
): Promise<FetchedMerge> {
	if (useGitlabApi(opts?.env)) return apiMergeRequest(repoUrl, iid, opts!.env!);
	const slug = parseSlug(repoUrl);
	const view = (await glab(
		['mr', 'view', String(iid), '-R', slug, '-F', 'json'],
		opts?.env
	).then(extractJson)) as Record<string, unknown>;

	const author =
		typeof view.author === 'object' && view.author !== null
			? String((view.author as Record<string, unknown>).username ?? 'unknown')
			: 'unknown';

	const diff = await glab(['mr', 'diff', String(iid), '-R', slug, '--raw'], opts?.env);

	return {
		pr: {
			number: Number(view.iid ?? iid),
			title: String(view.title ?? ''),
			url: String(view.web_url ?? ''),
			author,
			base: String(view.target_branch ?? ''),
			headRef: String(view.source_branch ?? ''),
			headSha: String(view.sha ?? 'unknown'),
			additions: Number(view.additions ?? 0),
			deletions: Number(view.deletions ?? 0),
			changedFiles: Number(view.changes_count ?? 0),
			createdAt: typeof view.created_at === 'string' ? view.created_at : '',
			body: typeof view.description === 'string' ? view.description : ''
		},
		diff
	};
}

/** Open MRs for a repo, newest first. Stats come from per-MR views (the list
 *  endpoint omits diff stats); an MR whose view fails keeps zeroed stats
 *  rather than failing the whole list. Throws GhError. */
export async function listMergeRequests(
	repoUrl: string,
	opts?: { env?: Record<string, string>; limit?: number }
): Promise<PullRequest[]> {
	if (useGitlabApi(opts?.env)) return apiMergeRequests(repoUrl, opts!.env!, opts?.limit);
	const slug = parseSlug(repoUrl);
	const rows = extractJson(
		await glab(
			['mr', 'list', '-R', slug, '-F', 'json', '--per-page', String(opts?.limit ?? 20)],
			opts?.env
		)
	);
	if (!Array.isArray(rows)) throw new GhError('unknown', 'glab mr list returned non-array JSON');
	const prs = rows.flatMap((row) => {
		if (typeof row !== 'object' || row === null) return [];
		const item = row as Record<string, unknown>;
		const author =
			typeof item.author === 'object' && item.author !== null
				? String((item.author as Record<string, unknown>).username ?? 'unknown')
				: 'unknown';
		const pr: PullRequest = {
			number: Number(item.iid ?? 0),
			title: String(item.title ?? ''),
			url: String(item.web_url ?? ''),
			author,
			base: String(item.target_branch ?? ''),
			headRef: String(item.source_branch ?? ''),
			headSha: typeof item.sha === 'string' ? item.sha : 'unknown',
			additions: 0,
			deletions: 0,
			changedFiles: 0,
			createdAt: typeof item.created_at === 'string' ? item.created_at : '',
			assignees: gitlabPeople(item.assignees)
		};
		return pr.number > 0 ? [pr] : [];
	});
	await Promise.all(
		prs.map(async (pr) => {
			try {
				const view = (await glab(
					['mr', 'view', String(pr.number), '-R', slug, '-F', 'json'],
					opts?.env
				).then(extractJson)) as Record<string, unknown>;
				pr.additions = Number(view.additions ?? 0);
				pr.deletions = Number(view.deletions ?? 0);
				pr.changedFiles = Number(view.changes_count ?? 0);
				if (typeof view.sha === 'string') pr.headSha = view.sha;
			} catch {
				/* keep zeroed stats for this MR */
			}
		})
	);
	return prs;
}
