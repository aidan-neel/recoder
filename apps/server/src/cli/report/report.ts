import type {
	BriefQuestionReport,
	CoverageGap,
	CoverageSummary,
	Finding,
	ObligationReport,
	ReasoningEffort,
	ReviewFunnel,
	SubagentCap,
	TokenBudget
} from '@recoder/shared';
import type { LensId } from '../../review/pipeline/lenses/types.js';
import type { ReviewTarget } from '../review/options.js';

/** Raised when a field is removed or changes meaning, so a caller can refuse a report it does not understand. */
export const REPORT_SCHEMA_VERSION = 1;

/** A finding as a calling agent needs it: where, what, how sure, and the fix. Pipeline bookkeeping is left out. */
export type ReportFinding = Pick<
	Finding,
	| 'id'
	| 'title'
	| 'file'
	| 'line'
	| 'endLine'
	| 'side'
	| 'severity'
	| 'message'
	| 'suggestion'
	| 'category'
	| 'kind'
	| 'lens'
	| 'ruleId'
	| 'smell'
	| 'symbol'
	| 'claim'
	| 'patch'
	| 'relatedLocations'
	| 'verification'
>;

/** What was reviewed, resolved to commits where there are any. */
export interface ReportTarget {
	kind: ReviewTarget['kind'];
	/** Absolute path of the repository; null for a bare diff. */
	repoPath: string | null;
	/** The ref or commit the change is measured against, as the caller named it or as it was detected. */
	base: string | null;
	head: string | null;
	baseSha: string | null;
	mergeBaseSha: string | null;
	headSha: string | null;
	/** The commit the review started after; null when it covered the whole change. */
	since: string | null;
	/** The run whose head `since` is; null for `--since` and a whole review. */
	sinceRunId: string | null;
	/** The pull request's address, for a `pull` target. */
	url: string | null;
	changedFiles: number;
}

/** The settings the review ran with, after flags, the budget and saved settings were combined. */
export interface ReportSettings {
	budget: TokenBudget;
	subagents: SubagentCap | number;
	reviewerModel: string | null;
	workerModel: string | null;
	/** Set when the verifier runs on a model different from `reviewerModel`; null or absent when it follows `reviewerModel`. */
	verifierModel?: string | null;
	reviewerEffort: ReasoningEffort | null;
	workerEffort: ReasoningEffort | null;
	/** Null when every lens that applies ran. */
	lenses: LensId[] | null;
	/** The `--include` path globs the review was narrowed to; empty when it saw every path. */
	include: string[];
	/** The `--exclude` path globs; empty when none were given. */
	exclude: string[];
	reportLowSeverity: boolean;
	/** Whether code could run. False when asked for, or when the machine has no sandbox; `execReason` says which. */
	exec: boolean;
	execReason: string | null;
}

/**
 * `complete`: the review ran to its end, with or without findings. `failed`: it stopped early; `error` says why and
 * the findings so far are kept. `cancelled`: a signal or `--timeout` stopped it.
 */
type ReportOutcome = 'complete' | 'failed' | 'cancelled';

/** Everything one review produced, for a calling agent to read. JSON-safe. */
export interface ReviewReport {
	schemaVersion: typeof REPORT_SCHEMA_VERSION;
	outcome: ReportOutcome;
	summary: string;
	error: string | null;
	target: ReportTarget;
	settings: ReportSettings;
	/** Findings the review stands behind, most severe first. */
	findings: ReportFinding[];
	/** Findings raised but not confirmed. */
	unconfirmed: ReportFinding[];
	/** Commands worth running before merging. */
	recommendedChecks: string[];
	coverage: CoverageSummary;
	coverageGaps: CoverageGap[];
	funnel: ReviewFunnel | null;
	questions: BriefQuestionReport | null;
	obligations: ObligationReport | null;
	startedAt: string;
	durationMs: number;
}
