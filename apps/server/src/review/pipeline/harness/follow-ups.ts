import { configForOrchestrator } from '../../../models/models.js';
import { withGuidelines } from '../../guidelines/guidelines.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import { canLaunchInvestigation, runJsonAgent } from '../agent-loop.js';
import {
	plannerResponseSchema,
	plannerSystemPrompt,
	plannerValidationError,
	sanitizePlannerOutput,
	type PlannerAssignment,
	type PlannerOutput
} from '../planner.js';
import { isCompactModel } from '../prompts.js';
import { assignCoverage, toAssignmentRecord, uniqueIds } from './assignments.js';
import { orchestratorAgentOptions, poolContext, publishPlan, type ReviewRun } from './context.js';
import { runAssignmentPool } from './pool.js';
import { failedAssignments, reportRetries } from './retries.js';

/**
 * The second wave: the orchestrator hears which specialists failed and which
 * follow-ups were asked for, then runs them together. Failed specialists always
 * rerun, adjusted for how they failed; the orchestrator says so in its conversation.
 * Runs at most once per review, including across a resume.
 */
export async function runSecondWave(run: ReviewRun, plan: PlannerOutput): Promise<void> {
	const { events } = run;

	const retries = run.followUpsDone
		? []
		: failedAssignments(run.items, run.assignments, run.dispatch.maxRetryAssignments);

	for (const retry of retries) {
		events?.onLog?.(`${retry.item.title} failed: ${retry.error}`, {
			assignmentId: retry.item.id,
			role: retry.item.role
		});
	}

	if (run.followUpsDone || (run.followUps.length === 0 && retries.length === 0)) return;
	if (!canLaunchInvestigation(run.investigationDeadline, run.budget)) return;

	if (retries.length) reportRetries(retries, events);

	const extra = uniqueIds(
		[...retries.map((retry) => retry.item), ...(await selectFollowUps(run))],
		run.assignments.map((record) => record.id)
	);

	run.followUpsDone = true;
	run.followUps.length = 0;
	run.items.push(...extra);

	for (const item of extra) {
		assignCoverage(run.coverage, item);

		const record = toAssignmentRecord(item, 'queued', true);

		run.assignments.push(record);
		events?.onAssignment?.(record);
	}

	if (!extra.length) return;

	publishPlan(run, plan, 2);
	await runAssignmentPool(extra, run.assignments, poolContext(run, []));
}

/** Follow-ups specialists asked for, deduplicated and sanitized, then narrowed by the orchestrator. */
async function selectFollowUps(run: ReviewRun): Promise<PlannerAssignment[]> {
	const { inventory, dispatch, directive, events } = run;
	const max = dispatch.maxFollowUpAssignments;

	if (max <= 0) return [];

	const unique = sanitizeFollowUps(run, max);

	if (unique.length === 0) return [];
	if (!canLaunchInvestigation(run.investigationDeadline, run.budget)) return unique;

	const cfg = configForOrchestrator();

	const result = await runJsonAgent({
		label: 'follow-up planning',
		...orchestratorAgentOptions(run, cfg),
		system: withGuidelines(
			plannerSystemPrompt({ dispatch, directive, compact: isCompactModel(cfg.model) }) +
				`\nThis is a follow-up pass. Dispatch at most ${max} narrowly scoped investigations.`,
			inventory.guidelines
		),
		user: `Pending follow-up requests:\n${JSON.stringify(unique, null, 2)}\n\nSelect at most ${max} follow-ups. Return planner JSON.`,
		maxTurns: REVIEW_POLICY.maxPlannerTurns,
		deadlineAt: run.investigationDeadline,
		parse: (raw) => sanitizePlannerOutput(raw, inventory, { followUp: true, maxAssignments: max, dispatch, directive }),
		validationError: plannerValidationError,
		responseSchema: plannerResponseSchema,
		onLog: (message) => events?.onLog?.(message)
	});

	return (result.value?.assignments ?? unique).slice(0, max);
}

/** Up to `max` distinct follow-up requests that pass the planner's checks, each under a `follow-` id. */
function sanitizeFollowUps(run: ReviewRun, max: number): PlannerAssignment[] {
	const unique: PlannerAssignment[] = [];
	const seen = new Set<string>();

	for (const request of run.followUps) {
		if (seen.has(request.id) || request.id === request.role) continue;

		const sanitized = sanitizePlannerOutput(
			{ summary: 'follow-up', assignments: [request], roleDecisions: [] },
			run.inventory,
			{ followUp: true, dispatch: run.dispatch, directive: run.directive }
		);

		if (!sanitized?.assignments[0]) continue;
		seen.add(request.id);

		unique.push({
			...sanitized.assignments[0],
			id: request.id.startsWith('follow-') ? request.id : `follow-${request.id}`
		});

		if (unique.length >= max) break;
	}

	return unique;
}
