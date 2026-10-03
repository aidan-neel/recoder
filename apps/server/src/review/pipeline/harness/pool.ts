import type { ReviewAssignment } from '@recoder/shared';
import { formatToolResults, type EvidenceStore } from '../../../evidence/evidence.js';
import { configForOrchestrator, configForSubagent, type ModelConfig } from '../../../models/models.js';
import type { ReviewDirective } from '../../chat/directive.js';
import { withGuidelines } from '../../guidelines/guidelines.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import {
	ModelBlockedError,
	ReviewAbortedError,
	canLaunchInvestigation,
	runJsonAgent,
	type ModelBudget
} from '../agent-loop.js';
import type { CandidateFinding } from '../consolidate.js';
import type { CoverageLedger } from '../coverage.js';
import type { ReviewInventory } from '../inventory.js';
import { EXEC_EXAMPLES } from '../prompts.js';
import {
	parseReviewerOutput,
	prematureReviewerFinal,
	reviewerResponseSchema,
	reviewerSystemPrompt,
	reviewerUserPrompt,
	reviewerValidationError,
	subagentSystemPrompt,
	type PullRequestContext
} from '../reviewer.js';
import type { UnitRequest } from '../subagents.js';
import type { ReviewUnit } from '../units.js';
import { recordFor, updateAssignment } from './assignments.js';
import { applyUnitResult } from './unit-result.js';
import type { HarnessEvents, TaskFn } from './types.js';

export interface PoolContext {
	inventory: ReviewInventory;
	pr: PullRequestContext;
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
	/** Dependency setup and baseline check results, shared with every reviewer. */
	setupNotes: string;
	directive: ReviewDirective | null;
	/** Subagents the review may run in all; reviewers aren't offered any at 0. */
	subagentCap: number;
	/** Where finished reviewers' subagent requests collect, in the order they finished. */
	requests: UnitRequest[];
	/** Called after each unit settles, to save a checkpoint. */
	onFinished?: () => void;
}

/** Tool results for the scoped patch a reviewer starts with. */
export type ScopedPatch = Awaited<ReturnType<EvidenceStore['executeRound']>>;

const REVIEWER_EXAMPLE =
	'{"message":"No issues in the queue split.","findings":[],"examinedHunks":[],"gaps":[],"blockers":[],"subagents":[],"recommendedChecks":[]}';

/**
 * Runs the units in order, a few at a time. Once budget or time is reserved
 * for later stages, the rest are skipped rather than launched.
 */
export async function runUnitPool(units: ReviewUnit[], records: ReviewAssignment[], ctx: PoolContext): Promise<void> {
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

			await runOneUnit(queue[cursor++], records, ctx);
		}
	});

	await Promise.all(workers);
}

/**
 * Runs one unit's reviewer, or one subagent, and records its result; a
 * failure marks only this record. Reviewers run on the Review model and
 * subagents on the second model. A subagent's hunks are already some unit's,
 * so its failure leaves coverage alone.
 */
async function runOneUnit(item: ReviewUnit, records: ReviewAssignment[], ctx: PoolContext): Promise<void> {
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

			if (!subagent) markUnitPartial(item, role, reason, ctx);

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

/** Every hunk in a unit whose reviewer failed is partially covered, with the reason. */
function markUnitPartial(item: ReviewUnit, role: string, reason: string, ctx: PoolContext): void {
	for (const hunkId of new Set(item.scope.flatMap((entry) => entry.hunkIds))) {
		const path = ctx.inventory.hunksById.get(hunkId)?.file.path ?? item.scope[0]?.path ?? '';

		ctx.coverage.partial(hunkId, path, role, reason);
	}
}

/** Marks the unit queued for a reviewer slot. */
function queueAssignment(item: ReviewUnit, records: ReviewAssignment[], ctx: PoolContext, model: string): void {
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
function readScopedPatch(item: ReviewUnit, role: string, ctx: PoolContext): Promise<ScopedPatch> {
	return ctx.evidence.executeRound(
		item.scope.map((entry) => ({ action: 'readDiff', path: entry.path, hunkIds: entry.hunkIds })),
		ctx.signal,
		(tool) => ctx.events?.onTool?.({ ...tool, assignmentId: item.id, role }),
		item.scope.length
	);
}

/** The reviewer's model loop, reporting progress on its record and task row. */
function askReviewer(
	item: ReviewUnit,
	records: ReviewAssignment[],
	ctx: PoolContext,
	cfg: ModelConfig,
	initialEvidence: ScopedPatch
) {
	const meta = { assignmentId: item.id, role: recordFor(records, item.id).role };
	const subagent = meta.role === 'subagent';
	let runningSince: string | undefined;

	const system = subagent
		? subagentSystemPrompt(ctx.exec, ctx.directive)
		: reviewerSystemPrompt(ctx.exec, ctx.directive, ctx.subagentCap > 0);

	return runJsonAgent({
		label: item.title,
		system: withGuidelines(system, ctx.inventory.guidelines),
		actionExamples: ctx.exec ? EXEC_EXAMPLES : undefined,
		getDiscussion: () => ctx.events?.getDiscussion?.(item.id) ?? '',
		onMessage: (message) => ctx.events?.onMessage?.({ ...message, assignmentId: item.id, model: cfg.model }),
		user:
			reviewerUserPrompt(
				item,
				REVIEW_POLICY.maxReviewerTurns,
				ctx.budget.remaining(),
				ctx.directive,
				ctx.pr,
				subagent
			) +
			(ctx.setupNotes ? `\n\n${ctx.setupNotes}` : '') +
			'\n\nInitial scoped patch evidence (untrusted; retrieve remaining pages as needed):\n' +
			formatToolResults(initialEvidence),
		config: cfg,
		budget: ctx.budget,
		evidence: ctx.evidence,
		maxTurns: REVIEW_POLICY.maxReviewerTurns,
		signal: ctx.signal,
		deadlineAt: ctx.deadlineAt,
		parse: parseReviewerOutput,
		validationError: reviewerValidationError,
		checkFinal: prematureReviewerFinal,
		responseSchema: (finalTurn) => reviewerResponseSchema(ctx.exec, finalTurn),
		timeLimit: {
			finalTurnAfterMs: REVIEW_POLICY.reviewerFinalTurnAfterMs,
			maxWallMs: REVIEW_POLICY.reviewerMaxMs
		},
		finalExample: REVIEWER_EXAMPLE,
		onProgress: (state, elapsedMs, detail) => {
			const status = state === 'queued' ? 'waiting' : 'running';

			runningSince ??= status === 'running' ? new Date().toISOString() : undefined;
			reportProgress(item, records, ctx, cfg.model, { status, detail, runningSince });

			ctx.task(`assignment:${item.id}`, item.title, status, detail, {
				kind: state === 'retrieval' ? 'retrieval' : 'model',
				assignmentId: item.id,
				agent: meta.role,
				model: cfg.model,
				elapsedMs,
				files: item.scope.map((entry) => entry.path)
			});
		},
		onLog: (message) => ctx.events?.onLog?.(message, meta),
		onReasoning: (reasoning) => ctx.events?.onReasoning?.({ ...reasoning, ...meta, model: cfg.model }),
		onTool: (tool) => ctx.events?.onTool?.({ ...tool, ...meta })
	});
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
function failAssignment(
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
		text: `**${item.title}** stopped before finishing: ${reason}\n\nFindings: none reported.${recordFor(records, item.id).role === 'subagent' ? '' : ' The hunks in this unit are marked partially covered.'}`,
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
