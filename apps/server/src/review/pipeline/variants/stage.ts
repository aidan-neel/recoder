import { reviewVariant } from '../../../env.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import { assignCoverage } from '../harness/assignments.js';
import { extendDeadlines, orchestratorSays, publishUnits, saveCheckpoint, type ReviewRun } from '../harness/context.js';
import { partitionReviewers } from '../reviewers.js';
import { reviewerSlices, unitRecord, type ReviewUnit } from '../units.js';
import { askCoordinator } from './coordinator.js';
import { INDEPENDENT_PREFIX, independentPassUnits } from './independent-pass.js';
import { isSpecialistTree, planSpecialists, type SpecialistPlan } from './specialist-plan.js';

const TASK_ID = 'specialist-plan';
const LABEL = 'Plan specialists';

/**
 * Shapes the review for the experiment variant `RECODER_REVIEW_VARIANT` names, after the context stages and before
 * any reviewer runs: `independent-pass` adds a second pass over every slice, `specialist-tree` has the coordinator
 * hand the slices to specialists. Unset, it does nothing, so the review is the baseline. A resumed review keeps the
 * units its checkpoint saved and only sizes the budget and deadline for them again.
 */
export async function variantStage(run: ReviewRun): Promise<void> {
	const variant = reviewVariant();

	if (!variant) return;

	run.events?.onLog?.(`Review variant: ${variant}.`);

	if (variant === 'independent-pass') addIndependentPass(run);
	else await planSpecialistTree(run);

	sizeForVariant(run);
	publishUnits(run, 1);
	saveCheckpoint(run);
}

/** Queues one independent reviewer per slice, unless a resumed review already has them. */
function addIndependentPass(run: ReviewRun): void {
	if (run.units.some((unit) => unit.id.startsWith(INDEPENDENT_PREFIX))) return;

	for (const unit of independentPassUnits(reviewerSlices(run.units))) queueUnit(run, unit);
}

/**
 * Asks the coordinator, then replaces the slices' reviewers with the specialists it planned, recording every
 * decision and every task left unassigned in the orchestrator's conversation and the log. A resumed review that
 * already has its specialists keeps them.
 */
async function planSpecialistTree(run: ReviewRun): Promise<void> {
	if (isSpecialistTree(run.units)) return;

	run.task(TASK_ID, LABEL, 'running', 'Asking the coordinator which specialists read which slices', {
		kind: 'planning'
	});

	const slices = run.units;
	const answer = slices.length ? await askCoordinator(run, slices) : { failure: 'nothing to review' };
	const plan = planSpecialists(slices, answer);

	dropQueuedUnits(run);

	for (const unit of plan.units) queueUnit(run, unit);

	recordPlan(run, plan);
}

/** Removes the units no reviewer has started and their records, in place, since the pool reads the same list. */
function dropQueuedUnits(run: ReviewRun): void {
	const dropped = new Set(run.units.map((unit) => unit.id));
	const kept = run.assignments.filter((record) => !dropped.has(record.id));

	run.units = [];
	run.assignments.length = 0;
	run.assignments.push(...kept);
}

function queueUnit(run: ReviewRun, unit: ReviewUnit): void {
	const record = unitRecord(unit);

	run.units.push(unit);
	assignCoverage(run.coverage, unit);
	run.assignments.push(record);
	run.events?.onAssignment?.(record);
}

/** Every dispatch decision and unassigned task, as the orchestrator's note, one log line each, and the task's result. */
function recordPlan(run: ReviewRun, plan: SpecialistPlan): void {
	const decisions = plan.decisions.map(
		(decision) =>
			`- ${decision.specialist}: ${decision.outcome}${decision.slices.length ? ` over ${decision.slices.join(', ')}` : ''}. ${decision.reason}`
	);

	const unassigned = plan.unassigned.map((task) => `- ${task.specialist} does not read ${task.slice}. ${task.reason}`);
	const lines = [...decisions, ...unassigned];

	for (const line of lines) run.events?.onLog?.(`Specialist plan ${line.slice(2)}`);

	orchestratorSays(
		run.events,
		'message_specialist_plan',
		[
			`I planned ${plan.units.length} specialist${plan.units.length === 1 ? '' : 's'}:`,
			...decisions,
			...(unassigned.length ? ['', 'Left unassigned:', ...unassigned] : [])
		].join('\n')
	);

	const summary = `${plan.units.length} specialists, ${plan.unassigned.length} tasks left unassigned`;

	run.task(TASK_ID, LABEL, 'done', summary, { kind: 'planning' });
}

/**
 * Grows the model-call budget and the deadline by what the variant's reviewers add over the baseline's, which
 * `createRun` sized the review for, plus the coordinator's call. A tree with fewer specialists than slices keeps
 * the baseline's size.
 */
function sizeForVariant(run: ReviewRun): void {
	const baseline = partitionReviewers(run.inventory, run.limits, run.input.lenses).length;
	const added = Math.max(0, reviewerSlices(run.units).length - baseline);
	const repairs = REVIEW_POLICY.schemaRepairAttempts;
	const coordinator = isSpecialistTree(run.units) ? 1 + repairs : 0;

	run.budget.limit += added * (run.limits.reviewerTurns + repairs) + coordinator;
	extendDeadlines(run, added * REVIEW_POLICY.msPerAssignment);
}
