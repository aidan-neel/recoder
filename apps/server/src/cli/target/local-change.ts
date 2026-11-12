import type { ReviewStart, ReviewTarget } from '../review/options.js';
import { lastReviewCandidates } from '../runs/last-review.js';
import { checkedOutTarget, removedOnFailure } from './checked-out.js';
import { gitOutput, type GitCall } from './git.js';
import { resolveRange } from './range.js';
import type { ResolvedTarget, TargetRequest } from './resolve-target.js';
import { commitStaged, commitUncommitted } from './snapshot.js';
import { continuedStart, wholeStart, type CommitPlace } from './start-point.js';
import { cloneForReview, throwawayCheckoutPath } from './throwaway-clone.js';

/** The target kinds read from the user's own repository, with no forge and no network. */
export type LocalTarget = Extract<ReviewTarget, { kind: 'range' | 'staged' | 'uncommitted' }>;

/** The two ends of a local change, resolved to commits in the user's repository. */
export interface LocalChange {
	/** The base as the caller named it, or as it was detected. */
	baseName: string;
	headName: string;
	baseSha: string;
	mergeBaseSha: string;
	headSha: string;
}

/** Resolves a local change to commits, then clones the repository into a throwaway checkout of its head. */
export async function resolveLocalChange(request: TargetRequest, target: LocalTarget): Promise<ResolvedTarget> {
	const root = await gitOutput({ cwd: request.repoPath, signal: request.signal }, ['rev-parse', '--show-toplevel']);
	const call = { cwd: root, signal: request.signal };
	const change = await describeChange(call, target);
	const start = await startOf(call, target, change);
	const checkoutPath = throwawayCheckoutPath(root);

	return removedOnFailure(checkoutPath, async () => {
		await cloneForReview(call, checkoutPath, { ...change, mergeBaseSha: start.mergeBaseSha });

		return checkedOutTarget({
			request,
			headName: change.headName,
			pull: null,
			revision: {
				checkoutPath,
				headSha: change.headSha,
				targetSha: change.baseSha,
				mergeBaseSha: start.mergeBaseSha,
				targetRef: change.baseName
			},
			start
		});
	});
}

/**
 * Where a local change's review begins. Only a commit range continues after
 * the last review that counts; staged and uncommitted changes always review
 * everything they hold.
 */
async function startOf(call: GitCall, target: LocalTarget, change: LocalChange): Promise<ReviewStart> {
	if (target.kind !== 'range' || target.start.kind !== 'continue') return wholeStart(change);

	const place: CommitPlace = {
		cwd: call.cwd,
		signal: call.signal,
		headSha: change.headSha,
		mergeBaseSha: change.mergeBaseSha
	};

	const continued = await continuedStart(place, await lastReviewCandidates(), change.headName);

	return continued ?? wholeStart(change);
}

function describeChange(call: GitCall, target: LocalTarget): Promise<LocalChange> {
	switch (target.kind) {
		case 'range':
			return resolveRange(call, target);
		case 'staged':
			return commitStaged(call);
		case 'uncommitted':
			return commitUncommitted(call);
	}
}
