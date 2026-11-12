import type { ReviewRevision } from '../../evidence/evidence.js';
import { CliError, usageError } from '../exit.js';
import type { PullStart, ReviewStart } from '../review/options.js';
import { lastReviewCandidates, type ReviewCandidate } from '../runs/last-review.js';
import { shortSha } from '../short-sha.js';
import { gitProbe } from './git.js';

/** A commit SHA, whole or abbreviated. Anything else could name a ref or read as an option. */
const COMMIT_SHA = /^[0-9a-f]{4,64}$/i;

/** A whole commit SHA, as git prints it and a report stores it. */
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Where a reader who asked for too much is sent. */
const WHOLE_PULL = 'Review the whole pull request without --since.';

/** The commits a start is checked against, and the checkout git reads them in. */
export interface CommitPlace {
	cwd: string;
	signal: AbortSignal;
	/** The change's head. */
	headSha: string;
	/** Where the whole change starts: its merge base with the base. */
	mergeBaseSha: string;
}

/** A pull revision with its start applied, and what the report records of it. */
export interface StartedPull {
	revision: ReviewRevision;
	start: ReviewStart;
}

/** What applying a pull's start needs: the revision, where it starts, and what stops it. */
export interface PullStartRequest {
	revision: ReviewRevision;
	start: PullStart;
	signal: AbortSignal;
	/** The head as the caller knows it, for the "nothing to review" message. */
	headName: string;
}

/**
 * The pull request's revision with its diff starting at `since`, so a later
 * review reads only the commits pushed after an earlier one. `since` must lie
 * on the pull request: an ancestor of its head, at or above where it left its
 * base branch. A rebase or force-push breaks that, and the error says to
 * review the whole pull request.
 */
async function startingAt(revision: ReviewRevision, since: string, signal: AbortSignal): Promise<ReviewRevision> {
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

/**
 * The pull request's revision with its start applied. `whole` reviews
 * everything; `named` starts the diff at the commit the caller named; and
 * `continue` starts it after the head of the last review that counts, or
 * reviews everything when none does.
 */
export async function startPullRevision(request: PullStartRequest): Promise<StartedPull> {
	const { revision, start, signal, headName } = request;

	if (start.kind === 'named') {
		const at = await startingAt(revision, start.commit, signal);

		return { revision: at, start: { mergeBaseSha: at.mergeBaseSha, since: at.mergeBaseSha, sinceRunId: null } };
	}

	if (start.kind === 'whole') return { revision, start: wholeStart(revision) };

	const place: CommitPlace = {
		cwd: revision.checkoutPath,
		signal,
		headSha: revision.headSha,
		mergeBaseSha: revision.mergeBaseSha
	};

	const continued = await continuedStart(place, await lastReviewCandidates(), headName);

	if (continued === null) return { revision, start: wholeStart(revision) };

	return { revision: { ...revision, mergeBaseSha: continued.mergeBaseSha }, start: continued };
}

/** The start of a review of the whole change: the diff starts at the merge base and names no earlier review. */
export function wholeStart(commits: { mergeBaseSha: string }): ReviewStart {
	return { mergeBaseSha: commits.mergeBaseSha, since: null, sinceRunId: null };
}

/**
 * Where a review that continues after the last review starts: the head of the
 * newest earlier run whose review of these commits still holds, or null when
 * none does and the whole change is reviewed. A candidate whose head is the
 * change's own head means that review already covered it: a usage error.
 */
export async function continuedStart(
	place: CommitPlace,
	candidates: readonly ReviewCandidate[],
	headName: string
): Promise<ReviewStart | null> {
	for (const candidate of candidates) {
		if (!(await stillCovers(place, candidate))) continue;

		if (candidate.headSha === place.headSha) throw alreadyReviewed(candidate, headName, place.headSha);

		return { mergeBaseSha: candidate.headSha, since: candidate.headSha, sinceRunId: candidate.runId };
	}

	return null;
}

/**
 * Whether an earlier run's review still covers the start of this change. Its
 * head must be a commit in the change's history, and the change must have
 * begun at the same commit then as now: the merge base of the run's base and
 * head is the change's merge base. A base that only moved forward keeps that.
 * A rebase, a merge of the base into the branch, or a base that named other
 * commits changes it, and the run reviewed another diff.
 */
async function stillCovers(place: CommitPlace, candidate: ReviewCandidate): Promise<boolean> {
	const { headSha, baseSha } = candidate;

	if (!(await isCommitHere(place, headSha)) || !(await isCommitHere(place, baseSha))) return false;
	if (!(await isAncestor(place, headSha, place.headSha))) return false;

	return (await gitProbe(place, ['merge-base', baseSha, headSha])) === place.mergeBaseSha;
}

/**
 * Whether a SHA from a stored report is the whole SHA of a commit in this
 * checkout. A report is outside input: an abbreviation, a ref name or a tag's
 * SHA could resolve to another commit, so only a SHA that resolves to itself
 * counts. One that names no commit here rules its run out.
 */
async function isCommitHere(place: CommitPlace, sha: string): Promise<boolean> {
	if (!FULL_SHA.test(sha)) return false;

	return (await gitProbe(place, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`])) === sha;
}

/** The last review already covered the head: there is nothing new to review. */
function alreadyReviewed(candidate: ReviewCandidate, headName: string, headSha: string): CliError {
	return usageError(
		`Nothing to review: run ${candidate.runId} already reviewed ${headName} up to ${shortSha(headSha)}. Pass --full to review the whole change again.`
	);
}

async function isAncestor(
	call: { cwd: string; signal: AbortSignal },
	ancestor: string,
	commit: string
): Promise<boolean> {
	return (await gitProbe(call, ['merge-base', '--is-ancestor', ancestor, commit])) !== null;
}
