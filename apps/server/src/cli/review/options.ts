import type { FindingSeverity, ReasoningEffort, SubagentCap, TokenBudget } from '@recoder/shared';
import type { LensId } from '../../review/pipeline/lenses/types.js';
import type { Audience } from '../audience.js';

/** Where a review of commits begins: the whole change, or after the last review that counts. */
export type CommitStart = { kind: 'whole' } | { kind: 'continue' };

/** Where a pull request's review begins: a commit range's start, or after a commit the caller names. */
export type PullStart = CommitStart | { kind: 'named'; commit: string };

/** Where a review of commits starts once resolved: where its diff begins and what the report records of it. */
export interface ReviewStart {
	/** Where the diff starts: the merge base, or the commit the review continues after. */
	mergeBaseSha: string;
	/** The commit the review started after; null when it covered the whole change. */
	since: string | null;
	/** The run whose head `since` is; null for `--since` and a whole review. */
	sinceRunId: string | null;
}

/** What `recoder review` reviews. Every kind but `diff` and `pull` reads the git repository at `repoPath`. */
export type ReviewTarget =
	/** Commits on `head` since it left `base`; a null base is the repository's default branch. `start` says where the review begins. */
	| { kind: 'range'; base: string | null; head: string; start: CommitStart }
	/** What is staged, against `HEAD`. */
	| { kind: 'staged' }
	/** Everything not yet committed, staged or not, untracked files included, against `HEAD`. */
	| { kind: 'uncommitted' }
	/** A pull or merge request on the repository's forge, by number or URL; `start` says where its review begins. */
	| { kind: 'pull'; pull: string; start: PullStart }
	/** A unified diff from a file, or from standard input for `-`. No checkout, so no code runs. */
	| { kind: 'diff'; source: string };

/** Paths the review is limited to, as git globs; both empty reviews the whole change. */
export interface ReviewScope {
	include: string[];
	exclude: string[];
}

/** What the change is meant to do, in the caller's words. The review reads it as untrusted text. */
export interface ReviewIntent {
	title: string | null;
	body: string | null;
	/** What to look for or leave out; costs one model call. */
	instructions: string | null;
}

/** Optional pipeline stages that are off unless named, each an env switch the pipeline already reads. */
export const REVIEW_LEVERS = {
	obligations: 'RECODER_OBLIGATIONS',
	'obligations-new-code': 'RECODER_OBLIGATIONS_NEW_CODE',
	'test-strength': 'RECODER_TEST_STRENGTH',
	'caller-selection': 'RECODER_CALLER_SELECTION',
	residual: 'RECODER_RESIDUAL',
	'contract-checks': 'RECODER_CONTRACT_CHECKS'
} as const;

export type ReviewLever = keyof typeof REVIEW_LEVERS;

/** How hard the review works. A null field takes the budget's value, or the saved setting where the budget has none. */
export interface ReviewTuning {
	budget: TokenBudget;
	/** Subagents the review may run in all; null is the budget's cap. */
	subagents: SubagentCap | number | null;
	/** Model id for reviewers; null is the saved Review model. */
	reviewerModel: string | null;
	/** Model id for subagents only; verifiers follow the Review model unless `verifierModel` is given. Null is the saved pick. */
	workerModel: string | null;
	/** Model id for verifiers; null is the saved pick, which follows the Review model when unset. */
	verifierModel: string | null;
	reviewerEffort: ReasoningEffort | null;
	workerEffort: ReasoningEffort | null;
	/** Lenses to run; null runs every lens that applies. */
	lenses: LensId[] | null;
	/** Whether low-severity findings are kept; null is the saved setting. */
	reportLowSeverity: boolean | null;
	/** False reviews read-only: no code runs, so bugs are reported unverified. */
	exec: boolean;
	/** False runs every baseline check again. */
	baselineCache: boolean;
	/** Characters of one file a reviewer may read at once; null is the saved setting. */
	maxFileChars: number | null;
	levers: ReviewLever[];
}

/** `text` is laid out for a terminal, `markdown` is a document, and `json` is every field. */
export type ReportFormat = 'text' | 'json' | 'markdown';

/** `live` redraws in place on a terminal and falls back to `text` lines anywhere else. */
export type ProgressFormat = 'none' | 'text' | 'ndjson' | 'live';

/** How the report is written. Filters apply when writing; the report itself always holds everything. */
export interface OutputOptions {
	/** Who reads the output; it decides what stands in for a report that went to a file. */
	audience: Audience;
	format: ReportFormat;
	/** Where the report goes; null is standard output. */
	file: string | null;
	/** Progress on standard error. */
	progress: ProgressFormat;
	/** Findings below this severity are left out of what is written. */
	minSeverity: FindingSeverity;
	/** Whether findings the review could not confirm are written. */
	includeUnconfirmed: boolean;
	/** Exit with `EXIT.findings` when a written finding is at or above this severity. */
	failOn: FindingSeverity | 'never';
}

/** One `recoder review` run, fully resolved from its flags. */
export interface ReviewOptions {
	/** Absolute path of the git repository; the working directory unless `--repo` names another. */
	repoPath: string;
	target: ReviewTarget;
	scope: ReviewScope;
	intent: ReviewIntent;
	tuning: ReviewTuning;
	output: OutputOptions;
	/** Stop the review after this long; null leaves it to the pipeline's own deadline. */
	timeoutMs: number | null;
	/** Leave the throwaway checkout on disk for inspection. */
	keepCheckout: boolean;
}
