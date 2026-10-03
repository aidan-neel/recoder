import type { ReviewPlanApproval } from '@recoder/shared';
import { configForOrchestrator } from '../../../models/models.js';
import { withGuidelines } from '../../guidelines/guidelines.js';
import { currentReviewControl } from '../../session/review-control.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import { ModelBlockedError, ReviewAbortedError, canLaunchInvestigation, runJsonAgent } from '../agent-loop.js';
import {
	fallbackPlan,
	plannerResponseSchema,
	plannerSystemPrompt,
	plannerUserPrompt,
	plannerValidationError,
	sanitizePlannerOutput,
	type PlannerOutput
} from '../planner.js';
import { isCompactModel } from '../prompts.js';
import { FINISHED, assignCoverage, toAssignmentRecord } from './assignments.js';
import { extendDeadlines, orchestratorAgentOptions, publishPlan, type ReviewRun } from './context.js';

const PLANNER_EXAMPLE =
	'{"message":"One correctness specialist on the changed module.","summary":"...","assignments":[{"id":"correctness-main","role":"correctness","title":"...","reason":"...","scope":[{"path":"src/a.ts","hunkIds":[]}],"questions":[],"contextEvidenceIds":[],"priority":1}],"roleDecisions":[{"role":"correctness","decision":"selected","reason":"..."}]}';

/**
 * The plan stage: plans the specialists (or restores a resumed review's plan),
 * records an assignment for each, and waits for approval when the plan is large.
 */
export async function planReview(run: ReviewRun, execNotes: string | undefined): Promise<PlannerOutput> {
	const resume = run.input.resume ?? null;
	const planOptions = { dispatch: run.dispatch, directive: run.directive };
	let plan = resume ? restorePlan(run) : await planOrFallBack(run, execNotes);

	if (plan.assignments.length === 0) {
		plan = fallbackPlan(run.inventory, undefined, planOptions);
		run.planningDegraded = true;
	}

	run.plan = plan;
	run.items = resume ? [...resume.items] : [...plan.assignments];

	if (resume) restoreRecords(run);
	else recordPlan(run, plan);

	publishPlan(run, plan, 1);

	run.task('planning', 'Planning the review', run.planningDegraded ? 'partial' : 'done', plan.summary, {
		kind: 'planning',
		agent: 'correctness'
	});

	if (!resume && run.items.length > run.dispatch.approvalThreshold && !currentReviewControl()?.unattended) {
		await awaitApproval(run);
	}

	scaleForPlanSize(run);

	return plan;
}

/** Picks a resumed review up from its checkpoint instead of planning again. */
function restorePlan(run: ReviewRun): PlannerOutput {
	const resume = run.input.resume!;

	run.evidence.restore(resume.evidence);
	run.coverage.restore(resume.coverage);
	run.events?.onLog?.('Continuing the review where it stopped');

	return resume.plan;
}

/** Runs the planner; any failure but a blocked model falls back to the bounded default plan. */
async function planOrFallBack(run: ReviewRun, execNotes: string | undefined): Promise<PlannerOutput> {
	try {
		run.task('planning', 'Planning the review', 'running', 'Planning specialist assignments', {
			kind: 'planning',
			agent: 'correctness'
		});

		const planned = await runPlanner(run, execNotes);

		run.planningDegraded = planned.degraded;

		return planned.plan;
	} catch (err) {
		if (err instanceof ModelBlockedError) throw err;
		run.planningDegraded = true;

		return fallbackPlan(run.inventory, err instanceof Error ? err.message : 'Planning failed', {
			dispatch: run.dispatch,
			directive: run.directive
		});
	}
}

/** Finished assignments keep their records; the rest are queued again. */
function restoreRecords(run: ReviewRun): void {
	for (const record of run.input.resume!.assignments) {
		const item = run.items.find((entry) => entry.id === record.id);

		run.assignments.push(
			FINISHED.has(record.status) || !item ? { ...record } : toAssignmentRecord(item, 'queued', record.followUp)
		);
	}
}

/** Queues every planned assignment and marks hunks no specialist covers as excluded. */
function recordPlan(run: ReviewRun, plan: PlannerOutput): void {
	for (const item of plan.assignments) {
		assignCoverage(run.coverage, item);
		run.assignments.push(toAssignmentRecord(item, 'queued'));
	}

	run.coverage.excludeUnassigned(
		run.inventory,
		`not assigned: specialist dispatch is ${run.dispatch.level} (Settings → Review harness)`
	);
}

/**
 * A plan past the approval threshold waits for the developer. Without a live
 * control (tests, scripts) there is nobody to ask; with one, the review waits
 * for a yes and a no cancels it. Unattended reviews skip this and run at the
 * dispatch cap.
 */
async function awaitApproval(run: ReviewRun): Promise<void> {
	const approval: ReviewPlanApproval = { status: 'pending', requested: run.items.length };

	run.events?.onApproval?.(approval);

	run.task(
		'approval',
		'Waiting for your go-ahead',
		'waiting',
		`This review needs ${run.items.length} specialists. Run them?`,
		{ kind: 'planning' }
	);

	await currentReviewControl()?.requestApproval();
	if (run.controller.signal.aborted) throw new ReviewAbortedError('review aborted');
	run.events?.onApproval?.({ ...approval, status: 'approved' });

	run.task('approval', `Running ${approval.requested} specialists`, 'done', 'You approved the review.', {
		kind: 'planning'
	});
}

/** A larger review gets proportionally more model calls and time. */
function scaleForPlanSize(run: ReviewRun): void {
	const extra = Math.max(0, run.items.length - REVIEW_POLICY.maxInitialAssignments / 2);

	if (!extra) return;

	run.budget.limit = REVIEW_POLICY.maxModelCalls + extra * REVIEW_POLICY.callsPerExtraAssignment;

	const waves = Math.ceil(run.items.length / REVIEW_POLICY.maxConcurrentAssignments) - 1;

	extendDeadlines(run, waves * REVIEW_POLICY.msPerExtraWave);
}

/** Asks the orchestrator model for a plan; invalid output or no budget yields a degraded fallback plan. */
async function runPlanner(
	run: ReviewRun,
	execNotes: string | undefined
): Promise<{ plan: PlannerOutput; degraded: boolean }> {
	const { inventory, events, input } = run;
	const cfg = configForOrchestrator();
	const planOptions = { dispatch: run.dispatch, directive: run.directive };

	if (!canLaunchInvestigation(run.investigationDeadline, run.budget)) {
		return {
			plan: fallbackPlan(inventory, 'No model budget remained for planning.', planOptions),
			degraded: true
		};
	}

	const result = await runJsonAgent({
		label: 'planner',
		...orchestratorAgentOptions(run, cfg),
		system: withGuidelines(
			plannerSystemPrompt({ exec: Boolean(run.workspace), compact: isCompactModel(cfg.model), ...planOptions }),
			inventory.guidelines
		),
		user: plannerUserPrompt({
			title: input.prTitle ?? '',
			body: input.prBody ?? '',
			context: input.prContext ?? '',
			inventory,
			execNotes,
			directive: run.directive
		}),
		maxTurns: REVIEW_POLICY.maxPlannerTurns,
		deadlineAt: run.investigationDeadline,
		parse: (raw) => sanitizePlannerOutput(raw, inventory, planOptions),
		validationError: plannerValidationError,
		responseSchema: plannerResponseSchema,
		finalExample: PLANNER_EXAMPLE,
		onProgress: (state, elapsedMs, detail) =>
			run.task('planning', 'Planning the review', state === 'queued' ? 'waiting' : 'running', detail, {
				kind: 'planning',
				agent: 'correctness',
				model: cfg.model,
				elapsedMs
			}),
		onLog: (message) => events?.onLog?.(message, { role: 'correctness' })
	});

	if (result.value) return { plan: result.value, degraded: false };

	return {
		plan: fallbackPlan(
			inventory,
			result.error ?? 'Planner output was invalid; using bounded fallback assignments.',
			planOptions
		),
		degraded: true
	};
}
