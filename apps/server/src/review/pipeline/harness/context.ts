import {
	DEFAULT_SUBAGENT_CAP,
	ORCHESTRATOR_ID,
	type Finding,
	type ReviewAssignment,
	type ReviewContext
} from '@recoder/shared';
import { EvidenceStore } from '../../../evidence/evidence.js';
import { configForOrchestrator, reviewLimits, type ModelConfig } from '../../../models/models.js';
import { execUnavailableReason } from '../../../sandbox/exec-sandbox.js';
import { ExecWorkspace } from '../../../sandbox/exec-workspace.js';
import { scopeOfCheckout } from '../../../sandbox/shared-install.js';
import type { ReviewDirective } from '../../chat/directive.js';
import { reviewNow } from '../../session/review-control.js';
import { REVIEW_POLICY, scaledReviewLimits } from '../../session/review-policy.js';
import { ModelBudget } from '../agent-loop.js';
import type { JsonAgentOptions } from '../agent-loop/options.js';
import { listDismissals, type Dismissal } from '../../guidelines/learned/dismissals.js';
import type { RuleLedger } from '../../guidelines/ledger/types.js';
import type { ChangeModel } from '../change-model/types.js';
import { isReportable, type CandidateFinding } from '../consolidate.js';
import type { DetectorResult } from '../detectors/types.js';
import { CoverageLedger } from '../coverage.js';
import type { ChangeIntent } from '../intent/types.js';
import { buildInventory, type ReviewInventory } from '../inventory.js';
import { lensAssignments } from '../lenses/lenses.js';
import { extraExcludes } from '../review-scope.js';
import { restoreSubagentState, type SubagentState } from '../subagents.js';
import { partitionUnits, type ReviewUnit } from '../units.js';
import { FINISHED } from './assignments.js';
import type { PoolContext } from './pool.js';
import { emptyReceived, receivedOf, recordingReads, reviewContext, type Received } from './received.js';
import type { AdaptiveReviewInput, BaselineResult, HarnessEvents, TaskFn } from './types.js';
import type { VerifyQueue } from './verify-queue.js';

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
	assignments: ReviewAssignment[];
	candidates: CandidateFinding[];
	/** The verifiers, open from before the first reviewer until the last verdict; null until then. */
	verifying: VerifyQueue | null;
	/** Every changed symbol with its callers, callees, tests and comparable code; null until built or when nothing parses. */
	changeModel: ChangeModel | null;
	/** What the change is meant to do; null when there was no context to distill. */
	intent: ChangeIntent | null;
	/** The repo's guidelines as numbered rules; null when the repo has none. */
	ledger: RuleLedger | null;
	/** Findings people dismissed in this repository, newest first; empty without a repository. */
	dismissals: Dismissal[];
	/** The type check, lint and test runs on the PR head; empty without a sandbox. */
	baseline: BaselineResult[];
	/** Deterministic quality results on changed lines; the verifier turns them into proven candidates. */
	detections: DetectorResult[];
	/**
	 * Candidates the verifier could not establish. They are hidden from the
	 * developer, but kept so the summary and evals can count them.
	 */
	hidden: CandidateFinding[];
	recommended: Set<string>;
	/** Failed units were already retried, so a resume doesn't retry them again. */
	retriesDone: boolean;
	/** Subagents reviewers asked for, the brief questions they left unsettled or answered, and the subagents that run; kept apart from `units`, so they're never retried. */
	subagents: SubagentState;
	nextCandidate: number;
	/** Every reviewer's prompt as built and its retrievals, as places, so the review can record what each one received. */
	received: Received;
	/** Candidate repairs attempted so far, restored on resume so the review's repair cap holds across a restart. */
	repairs: number;
	/** Dependency setup and baseline check results, shared with every reviewer and verifier. */
	setupNotes: string;
	task: TaskFn;
}

/** Builds the run's shared state from the input, restoring what a resumed review carries over. */
export function createRun(input: AdaptiveReviewInput, events?: HarnessEvents): ReviewRun {
	const startedAt = reviewNow();
	const inventory = buildInventory(input.diff, extraExcludes());
	const limits = scaledReviewLimits(lensAssignments(partitionUnits(inventory)).length);
	const deadlineAt = startedAt + limits.deadlineMs;
	const resume = input.resume;

	return {
		input,
		events,
		controller: new AbortController(),
		budget: new ModelBudget(limits.modelCalls),
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
		assignments: [],
		candidates: (resume?.candidates ?? []).map((candidate) => ({ ...candidate })),
		verifying: null,
		changeModel: null,
		intent: null,
		ledger: null,
		dismissals: input.repoId ? listDismissals(input.repoId) : [],
		baseline: [],
		detections: [],
		hidden: [],
		recommended: new Set<string>(resume?.recommended ?? []),
		retriesDone: resume?.retriesDone ?? false,
		subagents: restoreSubagentState(resume?.subagents),
		nextCandidate: 1 + Math.max(0, ...(resume?.candidates ?? []).map((c) => Number(c.candidateId.slice(1)) || 0)),
		received: resume?.received ? structuredClone(resume.received) : emptyReceived(),
		repairs: resume?.repairs ?? 0,
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
	config: ModelConfig
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
		onReasoning: (reasoning) => events?.onReasoning?.({ ...reasoning, role: 'orchestrator', model: config.model }),
		onTool: (tool) => events?.onTool?.({ ...tool, role: 'orchestrator' })
	};
}

/** Opens the sandbox when code can run. */
export async function openWorkspace(run: ReviewRun): Promise<void> {
	const { revision } = run.input;

	run.execReason = !revision
		? 'Running code needs a local checkout of the pull request.'
		: await execUnavailableReason();

	const scope = revision ? scopeOfCheckout(revision.checkoutPath) : null;

	run.workspace =
		revision && !run.execReason
			? new ExecWorkspace(
					revision.checkoutPath,
					revision.headSha,
					undefined,
					scope ? { scope, baseSha: revision.mergeBaseSha } : undefined
				)
			: null;

	if (run.workspace) {
		syncWorkspaceDeadline(run);
		run.evidence.exec = run.workspace;
		run.investigationDeadline = run.deadlineAt - REVIEW_POLICY.reserveMsForVerification;
	} else if (run.execReason) {
		run.evidence.execUnavailable = run.execReason;
	}
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

export function publishCandidates(run: ReviewRun): void {
	run.events?.onCandidates?.(run.candidates.filter(isReportable).length);
}

/** Reports the units and subagents with every assignment record as it stands. */
export function publishUnits(run: ReviewRun, planVersion: number): void {
	const units = run.units.length;
	const subagents = run.subagents.units?.length ?? 0;

	run.events?.onPlan?.({
		planVersion,
		summary: `Reviewing in ${units} unit${units === 1 ? '' : 's'}${subagents ? ` with ${subagents} subagent${subagents === 1 ? '' : 's'}` : ''}`,
		assignments: run.assignments.map((assignment) => ({ ...assignment }))
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
		assignments: run.assignments.map((record) => ({ ...record })),
		candidates: kept.map((candidate) => ({ ...candidate })),
		coverage: run.coverage.snapshot(),
		evidence: run.evidence.snapshot(kept.flatMap((candidate) => candidate.evidenceIds ?? [])),
		recommended: [...run.recommended],
		retriesDone: run.retriesDone,
		subagents: structuredClone(run.subagents),
		...(run.repairs ? { repairs: run.repairs } : {}),
		received: receivedOf(run.received, finished)
	});
}

/** What each reviewer received, read and cited, and how each of `findings` got its evidence. */
export function receivedContext(run: ReviewRun, findings: Finding[]): ReviewContext {
	return reviewContext(
		{
			units: [...run.units, ...(run.subagents.units ?? [])],
			roles: new Map(run.assignments.map((record) => [record.id, record.role])),
			received: run.received,
			evidence: run.evidence,
			candidates: run.candidates
		},
		findings
	);
}

/** What a reviewer pool needs from the run. */
export function poolContext(run: ReviewRun): PoolContext {
	const { input, inventory } = run;

	return {
		inventory,
		pr: { title: input.prTitle ?? '', body: input.prBody ?? '', context: input.context?.people ?? '', inventory },
		evidence: run.evidence,
		coverage: run.coverage,
		budget: run.budget,
		deadlineAt: run.investigationDeadline,
		signal: run.controller.signal,
		events: recordingReads(run.received, run.evidence, run.events),
		received: run.received,
		task: run.task,
		candidates: run.candidates,
		nextCandidate: () => `c${run.nextCandidate++}`,
		recommended: run.recommended,
		exec: Boolean(run.workspace),
		setupNotes: () => run.setupNotes,
		directive: run.directive,
		subagentCap: run.input.subagentCap ?? DEFAULT_SUBAGENT_CAP,
		reportLowSeverity: run.input.reportLowSeverity ?? false,
		changeModel: run.changeModel,
		intent: run.intent,
		ledger: run.ledger,
		dismissals: run.dismissals,
		requests: run.subagents.requests,
		unsettled: run.subagents.unsettled,
		answered: run.subagents.answered,
		onCandidate: (candidate) => run.verifying?.add(candidate),
		onFinished: () => saveCheckpoint(run)
	};
}
