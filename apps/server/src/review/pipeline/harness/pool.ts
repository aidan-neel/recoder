import type { ReviewAssignment } from '@recoder/shared';
import { formatToolResults, type EvidenceStore } from '../../../evidence/evidence.js';
import { configForRole, type RoleConfig } from '../../../models/models.js';
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
import type { DispatchPolicy } from '../dispatch.js';
import type { ReviewInventory } from '../inventory.js';
import type { PlannerAssignment } from '../planner.js';
import { EXEC_EXAMPLES, isCompactModel } from '../prompts.js';
import {
	parseSpecialistOutput,
	prematureSpecialistFinal,
	specialistResponseSchema,
	specialistSystemPrompt,
	specialistUserPrompt,
	specialistValidationError
} from '../specialist.js';
import { recordFor, updateAssignment } from './assignments.js';
import { applySpecialistResult } from './specialist-result.js';
import type { HarnessEvents, TaskFn } from './types.js';

export interface PoolContext {
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
	followUps: PlannerAssignment[];
	/** Specialists may run code in the review sandbox. */
	exec: boolean;
	/** Dependency setup and baseline check results, shared with every specialist. */
	setupNotes: string;
	dispatch: DispatchPolicy;
	directive: ReviewDirective | null;
	/** Called after each assignment settles, to save a checkpoint. */
	onFinished?: () => void;
}

/** Tool results for the scoped patch a specialist starts with. */
export type ScopedPatch = Awaited<ReturnType<EvidenceStore['executeRound']>>;

const SPECIALIST_EXAMPLE =
	'{"message":"No issues in the queue split.","findings":[],"examinedHunks":[],"coverageGaps":[],"blockers":[],"followUp":null,"recommendedChecks":[]}';

/**
 * Runs the assignments in priority order, a few at a time. Once budget or time is
 * reserved for later stages, the rest are skipped rather than launched.
 */
export async function runAssignmentPool(
	items: PlannerAssignment[],
	records: ReviewAssignment[],
	ctx: PoolContext
): Promise<void> {
	const queue = [...items].sort((a, b) => a.priority - b.priority);
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

			await runOneAssignment(queue[cursor++], records, ctx);
		}
	});

	await Promise.all(workers);
}

/** Runs one specialist and records its result; a failure marks only this assignment. */
async function runOneAssignment(item: PlannerAssignment, records: ReviewAssignment[], ctx: PoolContext): Promise<void> {
	const cfg = configForRole(item.role);
	const model = cfg.model;

	queueAssignment(item, records, ctx, model);

	try {
		const initialEvidence = await readScopedPatch(item, ctx);
		const result = await askSpecialist(item, records, ctx, cfg, initialEvidence);

		if (!result.value) {
			const reason = result.error ?? 'specialist failed';

			for (const hunkId of new Set(item.scope.flatMap((entry) => entry.hunkIds))) {
				const path = ctx.inventory.hunksById.get(hunkId)?.file.path ?? item.scope[0]?.path ?? '';

				ctx.coverage.partial(hunkId, path, item.role, reason);
			}

			failAssignment(item, records, ctx, model, result.error ?? 'Specialist failed');

			return;
		}

		applySpecialistResult(item, records, ctx, model, result.value, initialEvidence);
	} catch (err) {
		if (err instanceof ModelBlockedError) throw err;
		if (err instanceof ReviewAbortedError) throw err;

		failAssignment(item, records, ctx, model, err instanceof Error ? err.message : 'Specialist failed');
	}
}

/** Marks the assignment queued for a specialist slot. */
function queueAssignment(item: PlannerAssignment, records: ReviewAssignment[], ctx: PoolContext, model: string): void {
	const queuedAt = new Date().toISOString();

	updateAssignment(records, item.id, {
		status: 'queued',
		model,
		queuedAt,
		currentOperation: 'Queued for specialist review'
	});

	ctx.events?.onAssignment?.(recordFor(records, item.id));

	ctx.task(`assignment:${item.id}`, item.title, 'queued', 'Queued for specialist review', {
		kind: 'assignment',
		assignmentId: item.id,
		agent: item.role,
		model,
		files: item.scope.map((entry) => entry.path),
		queuedAt,
		queueReason: 'Waiting for a specialist slot'
	});
}

/**
 * The first bounded patch page for every scoped file, supplied up front instead of
 * spending a model round asking for it. Every file gets a result (truncated once
 * the round budget is spent), so none silently drops out past the per-turn action limit.
 */
function readScopedPatch(item: PlannerAssignment, ctx: PoolContext): Promise<ScopedPatch> {
	return ctx.evidence.executeRound(
		item.scope.map((entry) => ({ action: 'readDiff', path: entry.path, hunkIds: entry.hunkIds })),
		ctx.signal,
		(tool) => ctx.events?.onTool?.({ ...tool, assignmentId: item.id, role: item.role }),
		item.scope.length
	);
}

/** The specialist's model loop, reporting progress on its record and task row. */
function askSpecialist(
	item: PlannerAssignment,
	records: ReviewAssignment[],
	ctx: PoolContext,
	cfg: RoleConfig,
	initialEvidence: ScopedPatch
) {
	const meta = { assignmentId: item.id, role: item.role };
	let runningSince: string | undefined;

	return runJsonAgent({
		label: item.title,
		system: withGuidelines(
			specialistSystemPrompt(item.role, ctx.exec, { compact: isCompactModel(cfg.model), directive: ctx.directive }),
			ctx.inventory.guidelines
		),
		actionExamples: ctx.exec ? EXEC_EXAMPLES : undefined,
		getDiscussion: () => ctx.events?.getDiscussion?.(item.id) ?? '',
		onMessage: (message) => ctx.events?.onMessage?.({ ...message, assignmentId: item.id, model: cfg.model }),
		user:
			specialistUserPrompt(item, ctx.dispatch.maxSpecialistTurns, ctx.budget.remaining(), ctx.directive) +
			(ctx.setupNotes ? `\n\n${ctx.setupNotes}` : '') +
			'\n\nInitial scoped patch evidence (untrusted; retrieve remaining pages as needed):\n' +
			formatToolResults(initialEvidence),
		config: cfg,
		budget: ctx.budget,
		evidence: ctx.evidence,
		maxTurns: ctx.dispatch.maxSpecialistTurns,
		signal: ctx.signal,
		deadlineAt: ctx.deadlineAt,
		parse: parseSpecialistOutput,
		validationError: specialistValidationError,
		checkFinal: prematureSpecialistFinal,
		responseSchema: (finalTurn) => specialistResponseSchema(ctx.exec, finalTurn),
		timeLimit: {
			finalTurnAfterMs: REVIEW_POLICY.specialistFinalTurnAfterMs,
			maxWallMs: REVIEW_POLICY.specialistMaxMs
		},
		finalExample: SPECIALIST_EXAMPLE,
		onProgress: (state, elapsedMs, detail) => {
			const status = state === 'queued' ? 'waiting' : 'running';

			runningSince ??= status === 'running' ? new Date().toISOString() : undefined;
			reportProgress(item, records, ctx, cfg.model, { status, detail, runningSince });

			ctx.task(`assignment:${item.id}`, item.title, status, detail, {
				kind: state === 'retrieval' ? 'retrieval' : 'model',
				assignmentId: item.id,
				agent: item.role,
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

/** The specialist's clock starts when a model first works for it (`runningSince`), not when it was queued. */
function reportProgress(
	item: PlannerAssignment,
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

/** A specialist that stopped without an answer: its record, task row and conversation all say so. */
function failAssignment(
	item: PlannerAssignment,
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
		text: `**${item.title}** stopped before finishing: ${reason}\n\nFindings: none reported. The hunks assigned to this specialist are marked partially covered.`,
		status: 'done',
		assignmentId: item.id,
		model
	});

	ctx.task(`assignment:${item.id}`, item.title, 'error', reason, {
		kind: 'assignment',
		assignmentId: item.id,
		agent: item.role,
		model
	});

	ctx.events?.onAssignment?.(recordFor(records, item.id));
}
