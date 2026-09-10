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
	| 'other';

export type CoverageState = 'pending' | 'reviewed' | 'partial' | 'excluded';

export type ReviewOutcome = 'complete' | 'partial' | 'failed';

export type RoleDecisionKind = 'selected' | 'not_needed' | 'deferred';

export type ReviewStage = 'checkout' | 'understand' | 'specialists' | 'consolidation';

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

export interface ReviewProgress {
	id: string;
	sequence: number;
	tasks: Record<string, ReviewTask>;
	activity: { sequence: number; message: string; at: string; agent?: string }[];
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
	recommendedChecks?: string[];
	stage?: ReviewStage;
	planningDegraded?: boolean;
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
