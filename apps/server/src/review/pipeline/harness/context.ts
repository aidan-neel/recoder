import { ORCHESTRATOR_ID, type ReviewAssignment } from '@recoder/shared';
import { EvidenceStore } from '../../../evidence/evidence.js';
import { configForOrchestrator, reviewLimits, type RoleConfig } from '../../../models/models.js';
import { execUnavailableReason } from '../../../sandbox/exec-sandbox.js';
import { ExecWorkspace } from '../../../sandbox/exec-workspace.js';
import type { ReviewDirective } from '../../chat/directive.js';
import { reviewNow } from '../../session/review-control.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import { ModelBudget } from '../agent-loop.js';
import type { JsonAgentOptions } from '../agent-loop/options.js';
import type { CandidateFinding } from '../consolidate.js';
import { CoverageLedger } from '../coverage.js';
import { buildInventory, type ReviewInventory } from '../inventory.js';
import { extraExcludes } from '../review-scope.js';
import type { ReviewUnit } from '../units.js';
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
	inventory: ReviewInventory;
	evidence: EvidenceStore;
	coverage: CoverageLedger;
	/** The sandbox agents run code in; null when code can't run in this review. */
	workspace: ExecWorkspace | null;
	/** Why code can't run, when it can't. */
	execReason: string | null;
	startedAt: number;
	/** On the review clock; extended for a large change and for setup time. */
	deadlineAt: number;
	/** When reviewers stop, early enough for verification to run. */
	investigationDeadline: number;
	/**
	 * Every unit the review launched, retries included. A review out of time
	 * once units exist still finishes with its candidates.
	 */
	units: ReviewUnit[];
	directive: ReviewDirective | null;
	planningDegraded: boolean;
	assignments: ReviewAssignment[];
	candidates: CandidateFinding[];
	recommended: Set<string>;
	/** Failed units were already retried, so a resume doesn't retry them again. */
	retriesDone: boolean;
	nextCandidate: number;
	/** Dependency setup and baseline check results, shared with every reviewer and verifier. */
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
		inventory,
		evidence: new EvidenceStore(input.revision ?? null, inventory, reviewLimits().maxFileChars),
		coverage: new CoverageLedger(),
		workspace: null,
		execReason: null,
		startedAt,
		deadlineAt,
		investigationDeadline: deadlineAt,
		units: [],
		directive: resume?.directive ?? null,
		planningDegraded: resume?.planningDegraded ?? false,
		assignments: [],
		candidates: (resume?.candidates ?? []).map((candidate) => ({ ...candidate })),
		recommended: new Set<string>(resume?.recommended ?? []),
		retriesDone: resume?.retriesDone ?? false,
		nextCandidate: 1 + Math.max(0, ...(resume?.candidates ?? []).map((c) => Number(c.candidateId.slice(1)) || 0)),
		setupNotes: '',
		task: (id, label, status, message, extra) =>
			events?.onTask?.({ id, label, status, message, kind: extra?.kind ?? 'other', ...extra })
	};
}

/** A finished note from the orchestrator in its conversation, so the developer sees why the review does what it does. */
export function orchestratorSays(events: HarnessEvents | undefined, id: string, text: string): void {
	events?.onMessage?.({
		id,
		text,
		status: 'done',
		assignmentId: ORCHESTRATOR_ID,
		model: configForOrchestrator().model
	});
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

/** Opens the sandbox when code can run. */
export async function openWorkspace(run: ReviewRun): Promise<void> {
	const { revision } = run.input;

	run.execReason = !revision
		? 'Running code needs a local checkout of the pull request.'
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

/** Reports the units with every assignment record as it stands. */
export function publishUnits(run: ReviewRun, planVersion: number): void {
	const count = run.assignments.length;

	run.events?.onPlan?.({
		planVersion,
		summary: `Reviewing in ${count} unit${count === 1 ? '' : 's'}`,
		assignments: run.assignments.map((assignment) => ({ ...assignment })),
		roleDecisions: [],
		planningDegraded: run.planningDegraded
	});
}

export function finishedIds(run: ReviewRun): Set<string> {
	return new Set(run.assignments.filter((record) => FINISHED.has(record.status)).map((record) => record.id));
}

/** Saves where the review stands; only finished units' candidates and evidence are kept. */
export function saveCheckpoint(run: ReviewRun): void {
	const { events } = run;

	if (!events?.onCheckpoint || !run.units.length) return;

	const finished = finishedIds(run);
	const kept = run.candidates.filter((candidate) => candidate.assignmentId && finished.has(candidate.assignmentId));

	events.onCheckpoint({
		units: run.units.map((unit) => ({ ...unit })),
		directive: run.directive,
		planningDegraded: run.planningDegraded,
		assignments: run.assignments.map((record) => ({ ...record })),
		candidates: kept.map((candidate) => ({ ...candidate })),
		coverage: run.coverage.snapshot(),
		evidence: run.evidence.snapshot(kept.flatMap((candidate) => candidate.evidenceIds ?? [])),
		recommended: [...run.recommended],
		retriesDone: run.retriesDone
	});
}

/** What a reviewer pool needs from the run. */
export function poolContext(run: ReviewRun): PoolContext {
	const { input, inventory } = run;

	return {
		inventory,
		pr: { title: input.prTitle ?? '', body: input.prBody ?? '', context: input.prContext ?? '', inventory },
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
		exec: Boolean(run.workspace),
		setupNotes: run.setupNotes,
		directive: run.directive,
		onFinished: () => saveCheckpoint(run)
	};
}
