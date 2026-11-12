import type { PullRequest, PullStatus } from '@recoder/shared';
import { localAdapter } from '../local/context.js';
import { listLocalPulls, viewLocalPull } from '../local/pulls.js';
import { parseSlug } from '../providers.js';
import { splitMessage, UnsupportedPullAction, type PullForge } from './status.js';

/** How long reading a local pull request's commits may take. */
const COMMITS_TIMEOUT_MS = 20_000;

/**
 * Pull requests in a local repository's metadata file. There is no forge
 * behind it: no checks, no conversation to write to, nothing to merge with.
 */
export function localPullForge(repoUrl: string): PullForge {
	return {
		comments: false,
		checks: false,

		async list() {
			return (await listLocalPulls(repoUrl)).map((pull) => ({ pull, status: localStatus(pull, 'open') }));
		},

		async view(n) {
			const { pr, state } = await viewLocalPull(repoUrl, n);

			return { pull: pr, status: localStatus(pr, state) };
		},

		async commits(pull) {
			const adapter = localAdapter(repoUrl, parseSlug(repoUrl), pull.number, AbortSignal.timeout(COMMITS_TIMEOUT_MS));
			const rows = await adapter.commits(await adapter.pull());

			return rows.map((row) => {
				const name = row.author ?? 'unknown';

				return {
					sha: row.sha,
					...splitMessage(row.message),
					author: { login: name, name, avatarUrl: null },
					authoredAt: row.at ?? '',
					url: null
				};
			});
		},

		conversation: refuse,
		comment: refuse,

		async mergeMethods() {
			return [];
		},

		merge: refuse
	};
}

/** A local pull request has no activity log, so its open time stands for its last activity. */
function localStatus(pull: PullRequest, state: PullStatus['state']): PullStatus {
	return { state, draft: false, mergeability: 'unknown', updatedAt: pull.createdAt, checks: null, commits: null };
}

function refuse(): never {
	throw new UnsupportedPullAction(
		'Local repositories have no forge to comment on or merge with. Use GitHub or GitLab.'
	);
}
