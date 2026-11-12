import type { ReviewRevision } from '../../evidence/evidence.js';
import { usageError } from '../exit.js';
import { gitProbe } from './git.js';

/** A commit SHA, whole or abbreviated. Anything else could name a ref or read as an option. */
const COMMIT_SHA = /^[0-9a-f]{4,64}$/i;

/** Where a reader who asked for too much is sent. */
const WHOLE_PULL = 'Review the whole pull request without --since.';

/**
 * The pull request's revision with its diff starting at `since`, so a later
 * review reads only the commits pushed after an earlier one. `since` must lie
 * on the pull request: an ancestor of its head, at or above where it left its
 * base branch. A rebase or force-push breaks that, and the error says to
 * review the whole pull request.
 */
export async function startingAt(
	revision: ReviewRevision,
	since: string,
	signal: AbortSignal
): Promise<ReviewRevision> {
	if (!COMMIT_SHA.test(since)) throw usageError('--since takes a commit SHA.');

	const call = { cwd: revision.checkoutPath, signal };
	const sha = await gitProbe(call, ['rev-parse', '--verify', '--quiet', `${since}^{commit}`]);

	if (sha === null || !(await isAncestor(call, sha, revision.headSha))) {
		throw usageError(
			`--since ${since} is not in the history of the pull request's head; it may have been rebased or force-pushed. ${WHOLE_PULL}`
		);
	}

	if (sha === revision.headSha) throw usageError(`Nothing to review: --since ${since} is the pull request's head.`);

	if (!(await isAncestor(call, revision.mergeBaseSha, sha))) {
		throw usageError(`--since ${since} is older than where the pull request left ${revision.targetRef}. ${WHOLE_PULL}`);
	}

	return { ...revision, mergeBaseSha: sha };
}

async function isAncestor(
	call: { cwd: string; signal: AbortSignal },
	ancestor: string,
	commit: string
): Promise<boolean> {
	return (await gitProbe(call, ['merge-base', '--is-ancestor', ancestor, commit])) !== null;
}
