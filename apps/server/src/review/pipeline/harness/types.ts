import type {
	CoverageGap,
	CoverageSummary,
	Finding,
	ModelFailure,
	ReviewAssignment,
	ReviewBudgetSnapshot,
	ReviewChatMessage,
	ReviewGuidelinesUsed,
	ReviewOutcome,
	ReviewReasoningEntry,
	ReviewStage,
	ReviewTask
} from '@recoder/shared';
import type { ReviewRevision, ToolCallReport } from '../../../evidence/evidence.js';
import type { ReviewCheckpoint } from '../../session/review-checkpoint.js';

/** Callbacks the harness reports progress through; every one is optional. */
export interface HarnessEvents {
	onTask?: (task: Omit<ReviewTask, 'updatedAt'>) => void;
	onLog?: (message: string, meta?: { assignmentId?: string; role?: string }) => void;
	onPlan?: (data: { planVersion: number; summary: string; assignments: ReviewAssignment[] }) => void;
	onAssignment?: (assignment: ReviewAssignment) => void;
	onCoverage?: (coverage: CoverageSummary, gaps: CoverageGap[]) => void;
	onBudget?: (budget: ReviewBudgetSnapshot) => void;
	onCandidates?: (count: number) => void;
	onStage?: (stage: ReviewStage) => void;
	onReasoning?: (reasoning: Omit<ReviewReasoningEntry, 'at'>) => void;
	onMessage?: (message: Omit<ReviewChatMessage, 'at' | 'from'>) => void;
	getDiscussion?: (assignmentId?: string) => string;
	onTool?: (tool: ToolCallReport & { assignmentId?: string; role?: string }) => void;
	/** Which owner guidelines this review runs with (reported once, after inventory). */
	onGuidelines?: (used: ReviewGuidelinesUsed) => void;
	/** Where the review stands, so a failed run can continue from here. */
	onCheckpoint?: (checkpoint: ReviewProgressCheckpoint) => void;
}

/** A checkpoint as the harness sees it; the pipeline adds the format version, review id and revision. */
export type ReviewProgressCheckpoint = Omit<ReviewCheckpoint, 'version' | 'id' | 'headSha' | 'mergeBaseSha'>;

/** Reports a row in the review's task list. */
export type TaskFn = (
	id: string,
	label: string,
	status: ReviewTask['status'],
	message: string,
	extra?: Partial<ReviewTask>
) => void;

export interface AdaptiveReviewInput {
	diff: string;
	sandboxPath: string | null;
	revision?: ReviewRevision | null;
	prTitle?: string | null;
	prBody?: string | null;
	/** Reviewers, assignees, linked issues (untrusted). */
	prContext?: string | null;
	signal?: AbortSignal;
	/** What the developer asked for in the session before starting the review, verbatim. */
	instructions?: string | null;
	/** Subagents the review may run in all, from Settings; the shared default when unset. */
	subagentCap?: number;
	/** Continue a failed review: skip the units that finished. */
	resume?: ReviewProgressCheckpoint | null;
}

export interface AdaptiveReviewResult {
	findings: Finding[];
	unconfirmed: Finding[];
	summary: string;
	outcome: ReviewOutcome;
	recommendedChecks: string[];
	coverage: CoverageSummary;
	coverageGaps: CoverageGap[];
	assignments: ReviewAssignment[];
	error?: string;
	/** Set when a model call stopped the review, e.g. ChatGPT is signed out. */
	failure?: ModelFailure;
}
