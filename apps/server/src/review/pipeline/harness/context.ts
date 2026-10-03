import type { ReviewAssignment } from '@recoder/shared';
import { EvidenceStore } from '../../../evidence/evidence.js';
import { reviewLimits, type RoleConfig } from '../../../models/models.js';
import { execUnavailableReason } from '../../../sandbox/exec-sandbox.js';
import { ExecWorkspace } from '../../../sandbox/exec-workspace.js';
import type { ReviewDirective } from '../../chat/directive.js';
import { hasPendingChanges } from '../../session/pending-changes.js';
import { reviewNow } from '../../session/review-control.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import { ModelBudget } from '../agent-loop.js';
import type { JsonAgentOptions } from '../agent-loop/options.js';
import type { CandidateFinding } from '../consolidate.js';
import { CoverageLedger } from '../coverage.js';
import { currentDispatch, type DispatchPolicy } from '../dispatch.js';
import { buildInventory, type ReviewInventory } from '../inventory.js';
import type { PlannerAssignment, PlannerOutput } from '../planner.js';
import { extraExcludes } from '../review-scope.js';
import { FINISHED } from './assignments.js';
import type { PoolContext } from './pool.js';
import type { AdaptiveReviewInput, HarnessEvents, TaskFn } from './types.js';

/** Everything one review run shares between its stages; stages mutate it as they go. */
export interface ReviewRun {
	input: AdaptiveReviewInput;
	events?: HarnessEvents;
	/** Aborted by the developer's signal, the review clock, or cleanup. */
	controller: AbortController;
	budget: ModelBudget;
	dispatch: DispatchPolicy;
	inventory: ReviewInventory;
	evidence: EvidenceStore;
	coverage: CoverageLedger;
	/** The sandbox agents run code in; null when code can't run in this review. */
	workspace: ExecWorkspace | null;
	/** Why code can't run, when it can't. */
	execReason: string | null;
	startedAt: number;
	/** On the review clock; extended once the developer approves a large plan. */
	deadlineAt: number;
	/** When planning and specialists stop, early enough for verification to run. */
	investigationDeadline: number;
	/** Kept for the failure path: a review out of time after planning still finishes with its candidates. */
	plan: PlannerOutput | null;
	directive: ReviewDirective | null;
	planningDegraded: boolean;
	items: PlannerAssignment[];
	assignments: ReviewAssignment[];
	candidates: CandidateFinding[];
	recommended: Set<string>;
	followUps: PlannerAssignment[];
	followUpsDone: boolean;
	nextCandidate: number;
	/** Dependency setup and baseline check results, shared with every specialist and verifier. */
	setupNotes: string;
	task: TaskFn;
}

/** Builds the run's shared state from the input, restoring what a resumed review carries over. */
export function createRun(input: AdaptiveReviewInput, events?: HarnessEvents): ReviewRun {
	const startedAt = reviewNow();
	const deadlineAt = startedAt + REVIEW_POLICY.analysisDeadlineMs;
	const inventory = buildInventory(input.diff, extraExcludes());
	const resume = input.resume;

	return {
		input,
		events,
		controller: new AbortController(),
		budget: new ModelBudget(),
		dispatch: input.dispatch ?? currentDispatch(),
		inventory,
		evidence: new EvidenceStore(input.revision ?? null, inventory, reviewLimits().maxFileChars),
		coverage: new CoverageLedger(),
		workspace: null,
		execReason: null,
		startedAt,
		deadlineAt,
		investigationDeadline: deadlineAt,
		plan: null,
		directive: resume?.directive ?? null,
		planningDegraded: resume?.planningDegraded ?? false,
		items: [],
		assignments: [],
		candidates: (resume?.candidates ?? []).map((candidate) => ({ ...candidate })),
		recommended: new Set<string>(resume?.recommended ?? []),
		followUps: [...(resume?.followUps ?? [])],
		followUpsDone: resume?.followUpsDone ?? false,
		nextCandidate: 1 + Math.max(0, ...(resume?.candidates ?? []).map((c) => Number(c.candidateId.slice(1)) || 0)),
		setupNotes: '',
		task: (id, label, status, message, extra) =>
			events?.onTask?.({ id, label, status, message, kind: extra?.kind ?? 'other', ...extra })
	};
}

/**
 * The options every orchestrator call in the pipeline shares: its model, the run's budget,
 * evidence and abort signal, and its messages, reasoning and tool calls reported as the
 * orchestrator's (`__pipeline` conversation, correctness role).
 */
export function orchestratorAgentOptions(
	run: ReviewRun,
	config: RoleConfig
): Pick<
	JsonAgentOptions<unknown>,
	'getDiscussion' | 'onMessage' | 'config' | 'budget' | 'evidence' | 'signal' | 'onReasoning' | 'onTool'
> {
	const { events } = run;

	return {
		getDiscussion: () => events?.getDiscussion?.() ?? '',
		onMessage: (message) => events?.onMessage?.({ ...message, assignmentId: '__pipeline', model: config.model }),
		config,
		budget: run.budget,
		evidence: run.evidence,
		signal: run.controller.signal,
		onReasoning: (reasoning) => events?.onReasoning?.({ ...reasoning, role: 'correctness', model: config.model }),
		onTool: (tool) => events?.onTool?.({ ...tool, role: 'correctness' })
	};
}

/**
 * Opens the sandbox when code can run. Agents restore tracked files after every
 * command, which would wipe the developer's uncommitted fixes, so a dirty checkout runs no code.
 */
export async function openWorkspace(run: ReviewRun): Promise<void> {
	const { revision } = run.input;

	run.execReason = !revision
		? 'Running code needs a local checkout of the pull request.'
		: (await hasPendingChanges(revision.checkoutPath))
			? "The checkout has fixes that aren't committed and pushed yet. Push or discard them to let reviewers run code."
			: await execUnavailableReason();

	run.workspace = revision && !run.execReason ? new ExecWorkspace(revision.checkoutPath, revision.headSha) : null;

	if (run.workspace) {
		syncWorkspaceDeadline(run);
		run.evidence.exec = run.workspace;
		run.investigationDeadline = run.deadlineAt - REVIEW_POLICY.reserveMsForVerification;
	} else if (run.execReason) {
		run.evidence.execUnavailable = run.execReason;
	}

	run.budget.reserve =
		REVIEW_POLICY.reserveCallsForConsolidation + (run.workspace ? REVIEW_POLICY.reserveCallsForVerification : 0);
}

/** Commands in the sandbox stop early enough for consolidation to run. */
export function syncWorkspaceDeadline(run: ReviewRun): void {
	if (run.workspace) run.workspace.deadlineAt = run.deadlineAt - REVIEW_POLICY.reserveMsForConsolidation;
}

/** Moves both the review deadline and the investigation deadline later by `ms`. */
export function extendDeadlines(run: ReviewRun, ms: number): void {
	run.deadlineAt += ms;
	run.investigationDeadline += ms;
	syncWorkspaceDeadline(run);
}

export function publishCoverage(run: ReviewRun): void {
	run.events?.onCoverage?.(run.coverage.summary(), run.coverage.gaps());
}

export function publishBudget(run: ReviewRun): void {
	run.events?.onBudget?.(run.budget.snapshot());
}

export function validCandidates(candidates: CandidateFinding[]): CandidateFinding[] {
	return candidates.filter((candidate) => candidate.valid);
}

export function publishCandidates(run: ReviewRun): void {
	run.events?.onCandidates?.(validCandidates(run.candidates).length);
}

/** Reports the plan with every assignment record as it stands. */
export function publishPlan(run: ReviewRun, plan: PlannerOutput, planVersion: number): void {
	run.events?.onPlan?.({
		planVersion,
		summary: plan.summary,
		assignments: run.assignments.map((assignment) => ({ ...assignment })),
		roleDecisions: plan.roleDecisions,
		planningDegraded: run.planningDegraded
	});
}

export function finishedIds(run: ReviewRun): Set<string> {
	return new Set(run.assignments.filter((record) => FINISHED.has(record.status)).map((record) => record.id));
}

/** Saves where the review stands; only finished assignments' candidates and evidence are kept. */
export function saveCheckpoint(run: ReviewRun): void {
	const { events, plan } = run;

	if (!events?.onCheckpoint || !plan) return;

	const finished = finishedIds(run);
	const kept = run.candidates.filter((candidate) => candidate.assignmentId && finished.has(candidate.assignmentId));

	events.onCheckpoint({
		plan,
		directive: run.directive,
		planningDegraded: run.planningDegraded,
		items: [...run.items],
		assignments: run.assignments.map((record) => ({ ...record })),
		candidates: kept.map((candidate) => ({ ...candidate })),
		coverage: run.coverage.snapshot(),
		evidence: run.evidence.snapshot([
			...kept.flatMap((candidate) => candidate.evidenceIds ?? []),
			...run.items.flatMap((item) => item.contextEvidenceIds)
		]),
		recommended: [...run.recommended],
		followUps: [...run.followUps],
		followUpsDone: run.followUpsDone
	});
}

/** What a specialist pool needs from the run; `followUps` collects the follow-ups its specialists ask for. */
export function poolContext(run: ReviewRun, followUps: PlannerAssignment[]): PoolContext {
	return {
		inventory: run.inventory,
		evidence: run.evidence,
		coverage: run.coverage,
		budget: run.budget,
		deadlineAt: run.investigationDeadline,
		signal: run.controller.signal,
		events: run.events,
		task: run.task,
		candidates: run.candidates,
		nextCandidate: () => `c${run.nextCandidate++}`,
		recommended: run.recommended,
		followUps,
		exec: Boolean(run.workspace),
		setupNotes: run.setupNotes,
		dispatch: run.dispatch,
		directive: run.directive,
		onFinished: () => saveCheckpoint(run)
	};
}
