export type ReviewTaskStatus =
	| 'queued'
	| 'waiting'
	| 'running'
	| 'done'
	| 'error'
	| 'skipped'
	| 'partial';

/** Child operation under an assignment — never itself a reviewer identity. */
export type ReviewTaskKind =
	| 'checkout'
	| 'inventory'
	| 'planning'
	| 'assignment'
	| 'retrieval'
	| 'model'
	| 'consolidation'
	| 'setup'
	| 'checks'
	| 'verification'
	| 'other';

export type CoverageState = 'pending' | 'reviewed' | 'partial' | 'excluded';

export type ReviewOutcome = 'complete' | 'partial' | 'failed';

export type RoleDecisionKind = 'selected' | 'not_needed' | 'deferred';

export type ReviewStage = 'checkout' | 'understand' | 'checks' | 'specialists' | 'verify' | 'consolidation';

export type AssignmentStatus =
	| 'queued'
	| 'waiting'
	| 'running'
	| 'done'
	| 'partial'
	| 'error'
	| 'skipped';

/** Observable operations only: never model reasoning or generated response text. */
export interface ReviewTask {
	id: string;
	label: string;
	status: ReviewTaskStatus;
	message: string;
	agent?: string;
	model?: string;
	batch?: number;
	batches?: number;
	scout?: number;
	files?: string[];
	currentFile?: string;
	startedAt?: string;
	updatedAt: string;
	elapsedMs?: number;
	assignmentId?: string;
	kind?: ReviewTaskKind;
	queueReason?: string;
	queuedAt?: string;
	activityAt?: string;
	candidateCount?: number;
}

export interface ReviewAssignmentScope {
	path: string;
	hunkIds: string[];
}

export interface ReviewAssignment {
	id: string;
	role: string;
	title: string;
	reason: string;
	status: AssignmentStatus;
	scope: ReviewAssignmentScope[];
	questions?: string[];
	model?: string;
	candidateCount?: number;
	currentOperation?: string;
	followUp?: boolean;
	priority?: number;
	startedAt?: string;
	queuedAt?: string;
	completedAt?: string;
	elapsedMs?: number;
}

export interface RoleDecision {
	role: string;
	decision: RoleDecisionKind;
	reason: string;
}

export interface CoverageGap {
	path: string;
	hunkId?: string;
	role?: string;
	state: CoverageState;
	reason: string;
}

export interface CoverageSummary {
	reviewed: number;
	pending: number;
	partial: number;
	excluded: number;
	total: number;
}

export interface ReviewBudgetSnapshot {
	used: number;
	remaining: number;
	reserved: number;
	limit: number;
}

/** Provider reasoning/thinking text captured for a reviewer assignment. */
export interface ReviewReasoningEntry {
	id: string;
	assignmentId?: string;
	role?: string;
	model?: string;
	at: string;
	text: string;
	status?: 'streaming' | 'done' | 'error';
	/** The provider only returns a summary of its reasoning (ChatGPT), so the text is dropped and only the timing is kept. */
	summary?: boolean;
}

/** One observable model tool/retrieval call, with its result and timing. */
export interface ReviewToolCall {
	id: string;
	assignmentId?: string;
	role?: string;
	/** Display command, e.g. `rg -n "refill" src/rate-limit`. */
	command: string;
	status: 'running' | 'done' | 'error';
	exitCode: number | null;
	startedAt: string;
	finishedAt?: string;
	elapsedMs?: number;
	/** Short outcome summary, e.g. `3 matches` or `limiter.ts:61-84`. */
	summary?: string;
	/** The actual retrieval request, including revision and range. */
	input?: {
		action: string;
		revision?: string;
		path?: string;
		prefix?: string;
		startLine?: number;
		endLine?: number;
		query?: string;
		hunkIds?: string[];
		cursor?: string;
		/** `run`: the shell command executed in the review sandbox. */
		command?: string;
		timeoutSec?: number;
	};
	/** Bounded preview of the evidence returned to the agent. */
	result?: {
		content: string;
		truncated: boolean;
		evidenceId?: string;
		revision?: string;
		path?: string;
		error?: string;
	};
}

export const ORCHESTRATOR_ID = '__pipeline';

/** Source evidence attached to a developer question, independent of findings. */
export interface ReviewCodeContext {
	file: string;
	startLine: number;
	endLine: number;
	side: 'old' | 'new';
	quote: string;
	diffContext?: string;
}

/** What the developer can do about a failed request: sign in to ChatGPT, or set up a model. */
export type FailureAction = 'sign-in' | 'settings';

/** Why a model call failed, in words for the developer. */
export interface ModelFailure {
	reason: string;
	/** ChatGPT is signed out or its sign-in expired; signing in fixes it. */
	signIn?: boolean;
}

export interface ReviewChatMessage {
	id: string;
	assignmentId: string;
	from: 'user' | 'assistant' | 'system';
	text: string;
	at: string;
	status: 'streaming' | 'done' | 'error';
	model?: string;
	/** Interactive messages are included in subsequent review turns. */
	discussion?: boolean;
	/** Specialist conversation mirrored into the orchestrator transcript. */
	forwardedFrom?: string;
	codeContext?: ReviewCodeContext;
	/** Set on a reply the model could not finish. */
	failure?: ModelFailure;
}

/** One layer of owner review guidelines a review ran with. */
export interface ReviewGuidelinesLayer {
	source: 'global' | 'repo';
	/** Repo file path (`.recoder/REVIEW.md`) for the repo layer. */
	path?: string;
	/** Branch the repo layer was read from (the PR's base). */
	ref?: string;
	/** Commit the repo layer was read at. */
	sha?: string;
	chars: number;
	truncated: boolean;
}

/** Which owner guidelines a review used, so the UI can say why it behaved as it did. */
export interface ReviewGuidelinesUsed {
	layers: ReviewGuidelinesLayer[];
	/** Short hash of the composed guidelines text. */
	hash: string;
}

export interface ReviewProgress {
	id: string;
	sequence: number;
	tasks: Record<string, ReviewTask>;
	activity: { sequence: number; message: string; at: string; agent?: string }[];
	reasoning?: ReviewReasoningEntry[];
	toolCalls?: ReviewToolCall[];
	messages?: ReviewChatMessage[];
	orchestratorModel?: string;
	updatedAt: string;
	planVersion?: number;
	planSummary?: string;
	assignments?: ReviewAssignment[];
	roleDecisions?: RoleDecision[];
	budget?: ReviewBudgetSnapshot;
	candidateCount?: number;
	coverage?: CoverageSummary;
	coverageGaps?: CoverageGap[];
	outcome?: ReviewOutcome;
	/** Why a failed review stopped, when a model call caused it. */
	failure?: ModelFailure;
	recommendedChecks?: string[];
	stage?: ReviewStage;
	planningDegraded?: boolean;
	guidelines?: ReviewGuidelinesUsed;
	/** Held by the developer; model calls wait until resumed. */
	paused?: boolean;
}

export function emptyReviewProgress(id: string): ReviewProgress {
	return { id, sequence: 0, tasks: {}, activity: [], updatedAt: '' };
}

export function assignmentCounts(assignments: ReviewAssignment[] | undefined): {
	queued: number;
	waiting: number;
	active: number;
	complete: number;
	partial: number;
	failed: number;
	total: number;
} {
	const list = assignments ?? [];
	let queued = 0;
	let waiting = 0;
	let active = 0;
	let complete = 0;
	let partial = 0;
	let failed = 0;
	for (const assignment of list) {
		if (assignment.status === 'queued') queued++;
		else if (assignment.status === 'waiting') waiting++;
		else if (assignment.status === 'running') active++;
		else if (assignment.status === 'done') complete++;
		else if (assignment.status === 'partial') partial++;
		else if (assignment.status === 'error' || assignment.status === 'skipped') failed++;
	}
	return { queued, waiting, active, complete, partial, failed, total: list.length };
}

export function formatAssignmentHeadline(assignments: ReviewAssignment[] | undefined): string {
	const counts = assignmentCounts(assignments);
	if (counts.total === 0) return 'No specialists assigned yet';
	const parts: string[] = [];
	if (counts.active) parts.push(`${counts.active} reviewer${counts.active === 1 ? '' : 's'} active`);
	if (counts.waiting) parts.push(`${counts.waiting} waiting for a model`);
	if (counts.queued) parts.push(`${counts.queued} queued`);
	if (counts.complete) parts.push(`${counts.complete} complete`);
	if (counts.partial) parts.push(`${counts.partial} partial`);
	if (counts.failed) parts.push(`${counts.failed} failed`);
	return parts.join(' · ') || `${counts.total} specialist${counts.total === 1 ? '' : 's'}`;
}
