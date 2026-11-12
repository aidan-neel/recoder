import type {
	MergePullInput,
	MergePullResult,
	PullMergeability,
	PullMergeMethod,
	PullRequest,
	PullState,
	Repo
} from '@recoder/shared';
import { fetchChecks } from '../checks.js';
import { GhError } from '../cli.js';
import { str } from '../context/sources.js';
import { gitlabProject, useGitlabApi } from '../gitlab-api.js';
import { fetchMergeRequest, glabApi, glabWrite, listMergeRows } from '../glab.js';
import { tokenEnv } from '../tokens.js';
import { gitlabCommits, gitlabConversation, gitlabPostComment } from './gitlab-conversation.js';
import {
	capOpenPulls,
	mergeRefusal,
	OPEN_PULLS_ASKED,
	record,
	refusedMerge,
	tallyChecks,
	type PullEntry,
	type PullForge
} from './status.js';

/** Merge requests on GitLab, through the REST API with a token or `glab api` with its own login. */
export function gitlabPullForge(repo: Repo): PullForge {
	const env = tokenEnv('gitlab', repo.url);
	const project = gitlabProject(repo.url);

	return {
		comments: true,
		checks: true,

		async list() {
			const rows = await listMergeRows(repo.url, { env, limit: OPEN_PULLS_ASKED });

			return capOpenPulls(rows.map(({ pr, row }) => gitlabEntry(pr, row)));
		},

		/** One merge request read, with its diff, which is where GitLab's +/− counts come from. */
		async view(n) {
			const { pr, row } = await fetchMergeRequest(repo.url, n, { env });
			const entry = gitlabEntry(pr, row);
			const checks = tallyChecks((await fetchChecks(repo, pr.headSha)).map((check) => check.state));

			return { pull: pr, status: { ...entry.status, checks } };
		},

		commits: (pull) => gitlabCommits(project, pull.number, env),
		conversation: (pull) => gitlabConversation(project, pull, env),
		comment: (pull, body) => gitlabPostComment(repo.url, pull, body, env),

		async mergeMethods() {
			return gitlabMergeMethods(record(await glabApi(project, env)));
		},

		merge: (n, input) => mergeGitlabRequest(`${project}/merge_requests/${n}/merge`, input, env)
	};
}

/**
 * A merge request row as a list or page entry. The list endpoint carries no
 * pipeline, so its checks are null; the page reads them separately.
 */
function gitlabEntry(pull: PullRequest, row: Record<string, unknown>): PullEntry {
	return {
		pull,
		status: {
			state: GITLAB_STATES[String(row.state)] ?? 'open',
			draft: row.draft === true || row.work_in_progress === true,
			mergeability: gitlabMergeability(row),
			updatedAt: str(row.updated_at) ?? pull.createdAt,
			checks: null,
			commits: null
		}
	};
}

/** `locked` is GitLab's brief state while a merge runs, so the request still reads as open. */
const GITLAB_STATES: Record<string, PullState> = {
	opened: 'open',
	locked: 'open',
	merged: 'merged',
	closed: 'closed'
};

/** `detailed_merge_status` values that mean GitLab is still working the answer out. */
const MERGE_STATUS_PENDING = new Set(['checking', 'unchecked', 'preparing', 'approvals_syncing']);

/**
 * GitLab's merge status as one answer. `detailed_merge_status` (GitLab 15.6+)
 * names each blocker; any value not listed as clean, conflicting or pending
 * is a rule, a pipeline or an approval that blocks the merge. Older GitLab
 * only has `merge_status`.
 */
export function gitlabMergeability(row: Record<string, unknown>): PullMergeability {
	const detailed = str(row.detailed_merge_status);

	if (row.has_conflicts === true || detailed === 'conflict' || detailed === 'broken_status') return 'conflicts';
	if (detailed === 'mergeable') return 'clean';
	if (detailed) return MERGE_STATUS_PENDING.has(detailed) ? 'unknown' : 'blocked';
	if (row.merge_status === 'can_be_merged') return 'clean';
	if (row.merge_status === 'cannot_be_merged') return 'conflicts';

	return 'unknown';
}

/**
 * The project's merge methods. GitLab merges each request the project's one
 * way: `ff` (fast-forward only) keeps a linear history like a rebase, the
 * other two write a merge commit. Squashing is a per-request option unless
 * the project turns it off, or forces it, which leaves squash as the only way.
 */
export function gitlabMergeMethods(project: Record<string, unknown>): PullMergeMethod[] {
	const squash = project.squash_option !== 'never' ? (['squash'] as const) : [];

	if (project.squash_option === 'always') return [...squash];

	return [project.merge_method === 'ff' ? 'rebase' : 'merge', ...squash];
}

/**
 * Accept the merge request at `input.headSha` (GitLab refuses with 409 when
 * the source branch moved). The source branch is kept, and the merge never
 * waits for a pipeline. A refusal answers `merged: false` with GitLab's reason.
 */
async function mergeGitlabRequest(
	path: string,
	input: MergePullInput,
	env: Record<string, string>
): Promise<MergePullResult> {
	if (!env.GITLAB_TOKEN && useGitlabApi(env)) {
		throw new GhError('auth', 'Connect a GitLab token with the api scope in Settings → Connections.');
	}

	let merged: Record<string, unknown>;

	try {
		merged = record(
			await glabWrite(
				'PUT',
				path,
				{ sha: input.headSha, squash: input.method === 'squash', should_remove_source_branch: false },
				env
			)
		);
	} catch (err) {
		return mergeRefusal(err);
	}

	if (merged.state !== 'merged') return refusedMerge('GitLab took the merge but has not merged it yet.');

	return { merged: true, sha: str(merged.merge_commit_sha) ?? str(merged.squash_commit_sha) ?? null };
}
