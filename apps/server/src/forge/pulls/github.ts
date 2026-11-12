import type {
	MergePullInput,
	MergePullResult,
	PrCheck,
	PullMergeability,
	PullMergeMethod,
	PullState
} from '@recoder/shared';
import { str } from '../context/sources.js';
import { extractJson, gh, listPullRows, parseRepoSlug, viewPullRow, type PullRow } from '../gh.js';
import { tokenEnv } from '../tokens.js';
import { githubCommits, githubConversation, githubPostComment } from './github-conversation.js';
import { mergeRefusal, record, records, refusedMerge, tallyChecks, type PullEntry, type PullForge } from './status.js';

/** The `gh pr list` / `gh pr view` fields `PullStatus` is read from. */
const STATUS_FIELDS = ['state', 'isDraft', 'updatedAt', 'mergeable', 'mergeStateStatus', 'statusCheckRollup'];

/** Open pull requests the list asks `gh` for per repository. */
const LIST_LIMIT = 50;

/** Pull requests on GitHub: metadata, status and merges through `gh`, the conversation through the REST API. */
export function githubPullForge(repoUrl: string): PullForge {
	const env = tokenEnv('github');
	const slug = parseRepoSlug(repoUrl);

	return {
		comments: true,
		checks: true,

		async list() {
			const rows = await listPullRows(repoUrl, { env, limit: LIST_LIMIT, fields: STATUS_FIELDS });

			return rows.map(githubEntry);
		},

		async view(n) {
			return githubEntry(await viewPullRow(repoUrl, n, { env, fields: [...STATUS_FIELDS, 'commits'] }));
		},

		commits: (pull) => githubCommits(slug, pull.number),
		conversation: (pull) => githubConversation(slug, pull.number),
		comment: (pull, body) => githubPostComment(slug, pull, body),

		async mergeMethods() {
			const view = record(
				extractJson(
					await gh(['repo', 'view', slug, '--json', 'mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed'], env)
				)
			);

			return MERGE_SETTINGS.flatMap(([field, method]) => (view[field] === true ? [method] : []));
		},

		merge: (n, input) => mergeGithubPull(repoUrl, n, input, env)
	};
}

/** The repository setting that allows each merge method. */
const MERGE_SETTINGS: [string, PullMergeMethod][] = [
	['mergeCommitAllowed', 'merge'],
	['squashMergeAllowed', 'squash'],
	['rebaseMergeAllowed', 'rebase']
];

/** A `gh` row with the status fields as a list or page entry. */
function githubEntry({ pr, row }: PullRow): PullEntry {
	const commits = Array.isArray(row.commits) ? row.commits.length : null;

	return {
		pull: pr,
		status: {
			state: GITHUB_STATES[String(row.state)] ?? 'open',
			draft: row.isDraft === true,
			mergeability: githubMergeability(str(row.mergeable), str(row.mergeStateStatus)),
			updatedAt: str(row.updatedAt) ?? pr.createdAt,
			checks: tallyChecks(records(row.statusCheckRollup).map(rollupState)),
			commits
		}
	};
}

const GITHUB_STATES: Record<string, PullState> = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' };

/**
 * GitHub's `mergeable` and `mergeStateStatus` as one answer. `UNSTABLE` (a
 * check that is not required failed) and `HAS_HOOKS` still merge; `BEHIND`
 * (the base must be merged in first) and `DRAFT` do not.
 */
export function githubMergeability(mergeable?: string, mergeState?: string): PullMergeability {
	if (mergeable === 'CONFLICTING' || mergeState === 'DIRTY') return 'conflicts';
	if (mergeState === 'BLOCKED' || mergeState === 'BEHIND' || mergeState === 'DRAFT') return 'blocked';
	if (mergeState === 'CLEAN' || mergeState === 'HAS_HOOKS' || mergeState === 'UNSTABLE') return 'clean';

	return 'unknown';
}

/** One `statusCheckRollup` entry, a check run or a legacy commit status, as a check state. */
function rollupState(entry: Record<string, unknown>): PrCheck['state'] {
	if (entry.__typename === 'StatusContext') return STATUS_CONTEXT_STATES[String(entry.state)] ?? 'failed';
	if (entry.status !== 'COMPLETED') return 'pending';

	return CHECK_RUN_CONCLUSIONS[String(entry.conclusion)] ?? 'failed';
}

const STATUS_CONTEXT_STATES: Record<string, PrCheck['state']> = {
	SUCCESS: 'passed',
	PENDING: 'pending',
	EXPECTED: 'pending'
};

const CHECK_RUN_CONCLUSIONS: Record<string, PrCheck['state']> = {
	SUCCESS: 'passed',
	NEUTRAL: 'skipped',
	SKIPPED: 'skipped'
};

/**
 * `gh pr merge` pinned to the head the person saw. It never deletes the
 * branch and never passes `--admin`, so branch protection decides: a refusal
 * answers `merged: false` with GitHub's reason. A merge queue may take the
 * pull request without merging it yet, so the state is read back afterwards.
 */
async function mergeGithubPull(
	repoUrl: string,
	n: number,
	input: MergePullInput,
	env: Record<string, string>
): Promise<MergePullResult> {
	const slug = parseRepoSlug(repoUrl);

	try {
		await gh(
			['pr', 'merge', String(n), '--repo', slug, `--${input.method}`, '--match-head-commit', input.headSha],
			env
		);
	} catch (err) {
		return mergeRefusal(err);
	}

	const { row } = await viewPullRow(repoUrl, n, { env, fields: ['state', 'mergeCommit'] });

	if (row.state !== 'MERGED') {
		return refusedMerge('GitHub took the merge but has not merged it yet, for example because a merge queue holds it.');
	}

	return { merged: true, sha: str(record(row.mergeCommit).oid) ?? null };
}
