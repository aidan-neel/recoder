import type { ReviewRevision } from '../../evidence/evidence.js';
import { CliError, usageError } from '../exit.js';
import type { PullStart, ReviewStart } from '../review/options.js';
import { lastReviewCandidates, type ReviewCandidate } from '../runs/last-review.js';
import { gitProbe } from './git.js';

/** A commit SHA, whole or abbreviated. Anything else could name a ref or read as an option. */
const COMMIT_SHA = /^[0-9a-f]{4,64}$/i;

/** Where a reader who asked for too much is sent. */
const WHOLE_PULL = 'Review the whole pull request without --since.';

/** The characters of a SHA the "nothing to review" messages use. */
const SHORT_SHA = 7;

/** The commits a start is checked against, and the checkout git reads them in. */
export interface CommitPlace {
	cwd: string;
	signal: AbortSignal;
	/** The change's head. */
	headSha: string;
	/** Where the whole change starts: its merge base with the base. */
	mergeBaseSha: string;
	/** The tip of the base branch now. */
	baseSha: string;
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
		mergeBaseSha: revision.mergeBaseSha,
		baseSha: revision.targetSha
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
		const headSha = await countedHead(place, candidate);

		if (headSha === null) continue;

		if (headSha === place.headSha) throw alreadyReviewed(candidate, headName, place.headSha);

		return { mergeBaseSha: headSha, since: headSha, sinceRunId: candidate.runId };
	}

	return null;
}

/**
 * The commit an earlier run's head resolves to when its review still covers
 * this change, else null. The head must be a commit in the change's history,
 * at or above where the change left its base, and the run's base must be the
 * same base only moved forward; a rebase or another base breaks that.
 */
async function countedHead(place: CommitPlace, candidate: ReviewCandidate): Promise<string | null> {
	if (!COMMIT_SHA.test(candidate.headSha) || !COMMIT_SHA.test(candidate.baseSha)) return null;

	const headSha = await commitSha(place, candidate.headSha);

	if (headSha === null) return null;

	const baseSha = await commitSha(place, candidate.baseSha);

	if (baseSha === null) return null;
	if (!(await isAncestor(place, headSha, place.headSha))) return null;
	if (!(await isAncestor(place, place.mergeBaseSha, headSha))) return null;
	if (!(await isAncestor(place, baseSha, place.baseSha))) return null;

	return headSha;
}

/**
 * A stored SHA as the commit it names in this checkout, or null when it is
 * not a commit here. A report is outside input: a SHA that names no commit
 * rules its run out instead of failing the review.
 */
async function commitSha(place: CommitPlace, sha: string): Promise<string | null> {
	try {
		return await gitProbe(place, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
	} catch (error) {
		if (place.signal.aborted || !(error instanceof CliError)) throw error;

		return null;
	}
}

/** The last review already covered the head: there is nothing new to review. */
function alreadyReviewed(candidate: ReviewCandidate, headName: string, headSha: string): CliError {
	return usageError(
		`Nothing to review: run ${candidate.runId} already reviewed ${headName} up to ${headSha.slice(0, SHORT_SHA)}. Pass --full to review the whole change again.`
	);
}

async function isAncestor(
	call: { cwd: string; signal: AbortSignal },
	ancestor: string,
	commit: string
): Promise<boolean> {
	return (await gitProbe(call, ['merge-base', '--is-ancestor', ancestor, commit])) !== null;
}
