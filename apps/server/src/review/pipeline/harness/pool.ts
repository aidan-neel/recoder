import type { BriefQuestion, ReviewAssignment } from '@recoder/shared';
import { formatToolResults, type EvidenceStore } from '../../../evidence/evidence.js';
import {
	configForOrchestrator,
	configForSubagent,
	hasSeparateSpecialist,
	type ModelConfig
} from '../../../models/models.js';
import { withGuidelines } from '../../guidelines/guidelines.js';
import { dismissalsBlock } from '../../guidelines/learned/prompt.js';
import type { Dismissal } from '../../guidelines/learned/dismissals.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import {
	ModelBlockedError,
	ReviewAbortedError,
	canLaunchInvestigation,
	runJsonAgent,
	type ModelBudget
} from '../agent-loop.js';
import type { JsonAgentOptions } from '../agent-loop/options.js';
import { unitContextParts } from '../change-model/change-model.js';
import type { CandidateFinding } from '../consolidate.js';
import type { CoverageLedger } from '../coverage.js';
import type { ReviewInventory } from '../inventory.js';
import { isQualityLens, lensById } from '../lenses/lenses.js';
import type { Lens, LensId } from '../lenses/types.js';
import {
	announcedFinal,
	parseReviewerOutput,
	salvageReviewerOutput,
	prematureReviewerFinal,
	unrunCorrectnessFinal,
	reviewerResponseSchema,
	reviewerValidationError
} from '../reviewer.js';
import {
	reviewerSystemPrompt,
	reviewerUserPrompt,
	type ReviewerHeading,
	subagentSystemPrompt,
	type ReviewerPromptContext
} from '../reviewer-prompts.js';
import { followedUpBy } from '../question-ledger.js';
import { secondLookSystemPrompt } from '../second-look/prompts.js';
import type { UnitRequest } from '../subagents.js';
import type { ReviewUnit } from '../units.js';
import { workerDelegate } from '../workers/worker.js';
import { coverageRole, recordFor, updateAssignment } from './assignments.js';
import { capturePrompt, type Received } from './received.js';
import { applyUnitResult } from './unit-result.js';
import type { HarnessEvents, TaskFn } from './types.js';

/** What the pool needs from the run; the prompt fields (PR, intent, change model, ledger) come with it. */
export interface PoolContext extends ReviewerPromptContext {
	inventory: ReviewInventory;
	evidence: EvidenceStore;
	coverage: CoverageLedger;
	budget: ModelBudget;
	deadlineAt: number;
	signal: AbortSignal;
	events?: HarnessEvents;
	task: TaskFn;
	candidates: CandidateFinding[];
	nextCandidate: () => string;
	recommended: Set<string>;
	/** Reviewers may run code in the review sandbox. */
	exec: boolean;
	/** Dependency setup and baseline check results as they stand when a reviewer starts; the checks finish mid-review. */
	setupNotes: () => string;
	/** Subagents the review may run in all; correctness lenses aren't offered any at 0. */
	subagentCap: number;
	reportLowSeverity: boolean;
	/** Findings people dismissed in this repository, newest first; a candidate matching one is dropped and a lens reviewer is told of those on its files. */
	dismissals: Dismissal[];
	/** Where finished reviewers' subagent requests collect, in the order they finished. */
	requests: UnitRequest[];
	/** The brief's questions, where finished reviewers' answers and their evidence collect. */
	questions: BriefQuestion[];
	/** Called with each candidate a reviewer reports, so its verifier can start while others still review. */
	onCandidate?: (candidate: CandidateFinding) => void;
	/** Where each reviewer's prompt is recorded as it is built, with the reads its events record. */
	received: Received;
	/** Called after each unit settles, to save a checkpoint. */
	onFinished?: () => void;
}

/** Tool results for the scoped patch a reviewer starts with. */
export type ScopedPatch = Awaited<ReturnType<EvidenceStore['executeRound']>>;

const REVIEWER_EXAMPLE =
	'{"message":"No issues in the queue split.","findings":[],"examinedHunks":[],"gaps":[],"blockers":[],"subagents":[],"unsettled":[],"answered":[],"recommendedChecks":[]}';

/**
 * Runs the units in order, a few at a time, each through `runOne` (a lens
 * reviewer or subagent unless told otherwise). Once budget or time is reserved
 * for later stages, the rest are skipped rather than launched.
 */
export async function runUnitPool(
	units: ReviewUnit[],
	records: ReviewAssignment[],
	ctx: PoolContext,
	runOne: (item: ReviewUnit) => Promise<void> = (item) => runOneUnit(item, records, ctx)
): Promise<void> {
	const queue = [...units];
	let cursor = 0;

	const workers = Array.from({ length: Math.min(REVIEW_POLICY.maxConcurrentAssignments, queue.length) }, async () => {
		while (cursor < queue.length) {
			if (ctx.signal.aborted) return;

			if (!canLaunchInvestigation(ctx.deadlineAt, ctx.budget)) {
				while (cursor < queue.length) {
					const skipped = queue[cursor++];

					updateAssignment(records, skipped.id, {
						status: 'skipped',
						currentOperation: 'Not launched: budget or time reserved for consolidation'
					});

					ctx.events?.onAssignment?.(recordFor(records, skipped.id));
				}

				return;
			}

			await runOne(queue[cursor++]);
		}
	});

	await Promise.all(workers);
}

/**
 * Runs one lens assignment, or one subagent, and records its result; a
 * failure marks only this record. Lens reviewers run on the Review model and
 * subagents on the second model. A subagent's hunks are already some lens's,
 * so its failure leaves coverage alone.
 */
export async function runOneUnit(item: ReviewUnit, records: ReviewAssignment[], ctx: PoolContext): Promise<void> {
	const role = recordFor(records, item.id).role;
	const subagent = role === 'subagent';
	const cfg = subagent ? configForSubagent() : configForOrchestrator();
	const model = cfg.model;

	queueAssignment(item, records, ctx, model);

	try {
		const initialEvidence = await readScopedPatch(item, role, ctx);
		const result = await askReviewer(item, records, ctx, cfg, initialEvidence);

		if (!result.value) {
			const reason = result.error ?? 'reviewer failed';

			if (!subagent) markUnitPartial(item, reason, ctx);

			failAssignment(item, records, ctx, model, result.error ?? 'Reviewer failed');

			return;
		}

		applyUnitResult(item, records, ctx, model, result.value, initialEvidence);
	} catch (err) {
		if (err instanceof ModelBlockedError) throw err;
		if (err instanceof ReviewAbortedError) throw err;

		failAssignment(item, records, ctx, model, err instanceof Error ? err.message : 'Reviewer failed');
	}
}

/** Every hunk in a lens assignment that failed is partially covered for that lens, with the reason. */
function markUnitPartial(item: ReviewUnit, reason: string, ctx: PoolContext): void {
	const role = coverageRole(item);

	for (const hunkId of new Set(item.scope.flatMap((entry) => entry.hunkIds))) {
		const path = ctx.inventory.hunksById.get(hunkId)?.file.path ?? item.scope[0]?.path ?? '';

		ctx.coverage.partial(hunkId, path, role, reason);
	}
}

/** Marks the unit queued for a reviewer slot. */
export function queueAssignment(item: ReviewUnit, records: ReviewAssignment[], ctx: PoolContext, model: string): void {
	const queuedAt = new Date().toISOString();

	updateAssignment(records, item.id, {
		status: 'queued',
		model,
		queuedAt,
		currentOperation: 'Queued for review'
	});

	ctx.events?.onAssignment?.(recordFor(records, item.id));

	ctx.task(`assignment:${item.id}`, item.title, 'queued', 'Queued for review', {
		kind: 'assignment',
		assignmentId: item.id,
		agent: recordFor(records, item.id).role,
		model,
		files: item.scope.map((entry) => entry.path),
		queuedAt,
		queueReason: 'Waiting for a reviewer slot'
	});
}

/**
 * The first bounded patch page for every scoped file, supplied up front instead of
 * spending a model round asking for it. Every file gets a result (truncated once
 * the round budget is spent), so none silently drops out past the per-turn action limit.
 */
export function readScopedPatch(item: ReviewUnit, role: string, ctx: PoolContext): Promise<ScopedPatch> {
	return ctx.evidence.executeRound(
		item.scope.map((entry) => ({ action: 'readDiff', path: entry.path, hunkIds: entry.hunkIds })),
		ctx.signal,
		(tool) => ctx.events?.onTool?.({ ...tool, assignmentId: item.id, role }),
		item.scope.length
	);
}

/**
 * A lens reviewer's workers on the second model. Offered only when that model
 * differs from the Review model, since only then does handing work off save
 * Review usage. Their reads show in the reviewer's feed.
 */
function delegateFor(item: ReviewUnit, records: ReviewAssignment[], ctx: PoolContext) {
	if (!hasSeparateSpecialist()) return undefined;

	const meta = { assignmentId: item.id, role: recordFor(records, item.id).role };

	return workerDelegate({
		evidence: ctx.evidence,
		budget: ctx.budget,
		signal: ctx.signal,
		deadlineAt: ctx.deadlineAt,
		exec: Boolean(ctx.exec),
		label: item.title,
		changedFiles: ctx.inventory.files.filter((file) => !file.excludeReason).map((file) => file.path),
		setupNotes: ctx.setupNotes,
		onTool: (tool) => ctx.events?.onTool?.({ ...tool, assignmentId: item.id, role: 'worker' }),
		onLog: (message) => ctx.events?.onLog?.(message, meta)
	});
}

/** How a reviewer's empty or premature final answer is pushed back, by role and lens. */
function finalCheck(subagent: boolean, lens: LensId, canRun: boolean) {
	if (subagent) return prematureReviewerFinal;

	return lens === 'correctness' && canRun ? unrunCorrectnessFinal : announcedFinal;
}

/** What people already dismissed on a lens reviewer's files, ready to append to its prompt; empty for a subagent or when nothing applies. */
function dismissedNote(item: ReviewUnit, subagent: boolean, ctx: PoolContext): string {
	const block = subagent
		? ''
		: dismissalsBlock(
				ctx.dismissals,
				item.scope.map((entry) => entry.path)
			);

	return block ? `\n\n${block}` : '';
}

/**
 * The reviewer's model loop, reporting progress on its record and task row. A
 * lens gets a short, fixed procedure and few turns; a subagent's open question
 * gets more, and must read past its patch before it concludes empty.
 */
function askReviewer(
	item: ReviewUnit,
	records: ReviewAssignment[],
	ctx: PoolContext,
	cfg: ModelConfig,
	initialEvidence: ScopedPatch
) {
	const subagent = recordFor(records, item.id).role === 'subagent';

	const lens = lensById(item.lens ?? 'correctness');
	const maxTurns = subagent ? REVIEW_POLICY.maxSubagentTurns : REVIEW_POLICY.maxLensTurns;
	const defaultCategory = lens.categories[0];

	const delegate = subagent ? undefined : delegateFor(item, records, ctx);

	/** A second look only reads: verification runs every candidate it reports, so its turns go to finding them. */
	const exec = Boolean(ctx.exec) && !item.purpose;

	return runJsonAgent({
		stage: item.purpose ? 'second-look' : subagent ? 'subagent' : 'reviewer',
		label: item.title,
		system: withGuidelines(systemPrompt(item, subagent, lens, ctx, Boolean(delegate)), ctx.inventory.guidelines),
		exec,
		delegate,
		user: unitPrompt(
			item,
			ctx,
			maxTurns,
			subagent ? 'Subagent' : 'Unit',
			initialEvidence,
			dismissedNote(item, subagent, ctx)
		),
		config: cfg,
		budget: ctx.budget,
		evidence: ctx.evidence,
		maxTurns,
		signal: ctx.signal,
		deadlineAt: ctx.deadlineAt,
		parse: (raw) => parseReviewerOutput(raw, defaultCategory),
		validationError: (raw) => reviewerValidationError(raw, defaultCategory),
		salvage: (raw) => salvageReviewerOutput(raw, defaultCategory),
		checkFinal: finalCheck(subagent, lens.id, exec),
		responseSchema: (finalTurn) =>
			reviewerResponseSchema(exec, finalTurn, subagent ? [] : lens.categories, Boolean(delegate)),
		timeLimit: item.purpose
			? { finalTurnAfterMs: REVIEW_POLICY.secondLookFinalTurnAfterMs, maxWallMs: REVIEW_POLICY.secondLookMaxMs }
			: { finalTurnAfterMs: REVIEW_POLICY.reviewerFinalTurnAfterMs, maxWallMs: REVIEW_POLICY.reviewerMaxMs },
		...(item.purpose && { callDeadlineMs: REVIEW_POLICY.secondLookCallDeadlineMs }),
		finalExample: REVIEWER_EXAMPLE,
		...agentEvents(item, records, ctx, cfg.model)
	});
}

/**
 * A unit agent's system prompt: the role a second look was sent for, a
 * subagent's, or the lens procedure with the parts this reviewer is offered.
 */
function systemPrompt(item: ReviewUnit, subagent: boolean, lens: Lens, ctx: PoolContext, delegate: boolean): string {
	if (item.purpose) return secondLookSystemPrompt(item.purpose, ctx.directive);

	if (subagent) return subagentSystemPrompt(ctx.exec, ctx.directive, followedUpBy(ctx.questions, item.id).length > 0);

	return reviewerSystemPrompt(lens, ctx.exec, ctx.directive, {
		subagents: lens.id === 'correctness' && ctx.subagentCap > 0,
		unsettled: !isQualityLens(lens.id) && ctx.subagentCap > 0,
		delegate
	});
}

/**
 * A unit agent's opening message: its brief and budget under `heading`, the
 * sandbox setup notes, any `note`, then the first page of its scoped patch.
 * What the prompt holds is captured in `ctx.received` as it is built, for
 * lens units, subagents and obligation investigators alike.
 */
export function unitPrompt(
	item: ReviewUnit,
	ctx: PoolContext,
	turns: number,
	heading: ReviewerHeading,
	patch: ScopedPatch,
	note = ''
): string {
	const declarations = ctx.changeModel ? unitContextParts(ctx.changeModel, item.scope) : null;

	capturePrompt(ctx.received, item, ctx.inventory, declarations, patch);

	return (
		reviewerUserPrompt(item, { turns, calls: ctx.budget.remaining() }, ctx, declarations?.text ?? '', heading) +
		(ctx.setupNotes() ? `\n\n${ctx.setupNotes()}` : '') +
		note +
		'\n\nInitial scoped patch evidence (untrusted; retrieve remaining pages as needed):\n' +
		formatToolResults(patch)
	);
}

/** How a unit agent reports to the run: its discussion, messages, progress, logs, reasoning and tool calls. */
export function agentEvents(
	item: ReviewUnit,
	records: ReviewAssignment[],
	ctx: PoolContext,
	model: string
): Pick<JsonAgentOptions<unknown>, 'getDiscussion' | 'onMessage' | 'onProgress' | 'onLog' | 'onReasoning' | 'onTool'> {
	const meta = { assignmentId: item.id, role: recordFor(records, item.id).role };

	return {
		getDiscussion: () => ctx.events?.getDiscussion?.(item.id) ?? '',
		onMessage: (message) => ctx.events?.onMessage?.({ ...message, assignmentId: item.id, model }),
		onProgress: progressReporter(item, records, ctx, model),
		onLog: (message) => ctx.events?.onLog?.(message, meta),
		onReasoning: (reasoning) => ctx.events?.onReasoning?.({ ...reasoning, ...meta, model }),
		onTool: (tool) => ctx.events?.onTool?.({ ...tool, ...meta })
	};
}

/** An agent loop's progress callback that keeps the unit's record and task row current. */
function progressReporter(
	item: ReviewUnit,
	records: ReviewAssignment[],
	ctx: PoolContext,
	model: string
): NonNullable<JsonAgentOptions<unknown>['onProgress']> {
	let runningSince: string | undefined;

	return (state, elapsedMs, detail) => {
		const status = state === 'queued' ? 'waiting' : 'running';

		runningSince ??= status === 'running' ? new Date().toISOString() : undefined;
		reportProgress(item, records, ctx, model, { status, detail, runningSince });

		ctx.task(`assignment:${item.id}`, item.title, status, detail, {
			kind: state === 'retrieval' ? 'retrieval' : 'model',
			assignmentId: item.id,
			agent: recordFor(records, item.id).role,
			model,
			elapsedMs,
			files: item.scope.map((entry) => entry.path)
		});
	};
}

/** The reviewer's clock starts when a model first works for it (`runningSince`), not when it was queued. */
function reportProgress(
	item: ReviewUnit,
	records: ReviewAssignment[],
	ctx: PoolContext,
	model: string,
	progress: { status: 'waiting' | 'running'; detail: string; runningSince?: string }
): void {
	const { runningSince } = progress;

	updateAssignment(records, item.id, {
		status: progress.status,
		currentOperation: progress.detail,
		...(runningSince ? { startedAt: runningSince, elapsedMs: Date.now() - Date.parse(runningSince) } : {}),
		model
	});

	ctx.events?.onAssignment?.(recordFor(records, item.id));
}

/** A reviewer that stopped without an answer: its record, task row and conversation all say so. */
export function failAssignment(
	item: ReviewUnit,
	records: ReviewAssignment[],
	ctx: PoolContext,
	model: string,
	reason: string
): void {
	updateAssignment(records, item.id, {
		status: 'error',
		candidateCount: 0,
		currentOperation: reason,
		completedAt: new Date().toISOString()
	});

	ctx.events?.onMessage?.({
		id: `message_failed_${item.id}`,
		text: `**${item.title}** stopped before finishing: ${reason}\n\nFindings: none reported.${recordFor(records, item.id).role === 'reviewer' ? ' The hunks in this unit are marked partially covered.' : ''}`,
		status: 'done',
		assignmentId: item.id,
		model
	});

	ctx.task(`assignment:${item.id}`, item.title, 'error', reason, {
		kind: 'assignment',
		assignmentId: item.id,
		agent: recordFor(records, item.id).role,
		model
	});

	ctx.events?.onAssignment?.(recordFor(records, item.id));
}
