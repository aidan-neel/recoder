import type { ReviewRevision } from '../../evidence/evidence.js';
import type { ReportTarget } from '../report/report.js';
import type { ReviewScope, ReviewTarget } from '../review/options.js';
import { resolveDiffFile } from './diff-file.js';
import { resolveLocalChange } from './local-change.js';
import { resolvePull } from './pull.js';

/** What to review, as the command line resolved it. */
export interface TargetRequest {
	/** Absolute path of the user's git repository. */
	repoPath: string;
	target: ReviewTarget;
	scope: ReviewScope;
	signal: AbortSignal;
}

/** The change as the pipeline takes it, plus the throwaway checkout it runs in. */
export interface ResolvedTarget {
	/** Unified diff, merge base to head. */
	diff: string;
	/** The throwaway checkout; null for a bare diff. */
	sandboxPath: string | null;
	/** Null for a bare diff. */
	revision: ReviewRevision | null;
	/** From the forge for a pull target, else null. */
	title: string | null;
	body: string | null;
	report: ReportTarget;
	/** Removes the throwaway checkout; safe to call more than once. */
	dispose(): Promise<void>;
}

/**
 * Turns what to review into a diff and a throwaway checkout of its head. The
 * user's repository is only read: its working tree, index, HEAD, refs and
 * stash never change. Throws a `CliError` for anything the caller must act
 * on, and leaves nothing on disk when it throws.
 */
export async function resolveTarget(request: TargetRequest): Promise<ResolvedTarget> {
	const { target } = request;

	switch (target.kind) {
		case 'diff':
			return resolveDiffFile(target.source, request);
		case 'pull':
			return resolvePull(request, target.pull, target.since);
		default:
			return resolveLocalChange(request, target);
	}
}
