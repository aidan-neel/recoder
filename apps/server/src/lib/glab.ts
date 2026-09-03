import type { PullRequest, RemoteRepo } from '@recoder/shared';
import { runCommand } from '../commands/runner.js';
import { extractJson, GhError } from './gh.js';
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

/** Authenticated user (if any). Never throws. */
export async function glabAuth(
	env?: Record<string, string>
): Promise<{ authenticated: boolean; user: string | null }> {
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

/** MR metadata + unified diff via the glab CLI. Throws GhError. */
export async function fetchMergeRequest(
	repoUrl: string,
	iid: number,
	opts?: { env?: Record<string, string> }
): Promise<FetchedMerge> {
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
			changedFiles: Number(view.changes_count ?? 0)
		},
		diff
	};
}
