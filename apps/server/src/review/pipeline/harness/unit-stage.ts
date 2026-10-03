import { REVIEW_POLICY } from '../../session/review-policy.js';
import { canLaunchInvestigation } from '../agent-loop.js';
import { partitionUnits, unitRecord } from '../units.js';
import { FINISHED, assignCoverage } from './assignments.js';
import { extendDeadlines, poolContext, publishUnits, type ReviewRun } from './context.js';
import { runUnitPool } from './pool.js';
import { failedUnits, reportRetries } from './retries.js';

/**
 * Cuts the change into review units, or restores a resumed review's units, and
 * records a queued assignment for each. A larger change gets more model calls
 * and time.
 */
export function cutUnits(run: ReviewRun): void {
	const resume = run.input.resume ?? null;

	if (resume) restoreUnits(run);
	else {
		run.units = partitionUnits(run.inventory);

		for (const unit of run.units) {
			assignCoverage(run.coverage, unit, 'reviewer');
			run.assignments.push(unitRecord(unit));
		}
	}

	publishUnits(run, 1);
	scaleForUnits(run);
}

/**
 * Picks a resumed review up from its checkpoint: finished units and subagents
 * keep their records, the rest are queued again.
 */
function restoreUnits(run: ReviewRun): void {
	const resume = run.input.resume!;

	run.evidence.restore(resume.evidence);
	run.coverage.restore(resume.coverage);
	run.units = resume.units.map((unit) => ({ ...unit }));
	run.events?.onLog?.('Continuing the review where it stopped');

	const launched = [...run.units, ...(run.subagents.units ?? [])];

	for (const record of resume.assignments) {
		const unit = launched.find((entry) => entry.id === record.id);

		if (FINISHED.has(record.status) || !unit) run.assignments.push({ ...record });
		else run.assignments.push(unitRecord(unit, record.role));
	}
}

/** Units past `baseUnits` each add model calls, and each wave of concurrent reviewers past the first adds time. */
function scaleForUnits(run: ReviewRun): void {
	const extra = Math.max(0, run.units.length - REVIEW_POLICY.baseUnits);

	if (!extra) return;

	run.budget.limit = REVIEW_POLICY.maxModelCalls + extra * REVIEW_POLICY.callsPerExtraUnit;

	const waves = Math.ceil(run.units.length / REVIEW_POLICY.maxConcurrentAssignments) - 1;

	extendDeadlines(run, waves * REVIEW_POLICY.msPerExtraWave);
}

/**
 * Reruns the units whose reviewer failed, once, adjusted for how each failed;
 * the orchestrator says so in its conversation. Runs at most once per review,
 * including across a resume.
 */
export async function retryFailedUnits(run: ReviewRun): Promise<void> {
	if (run.retriesDone) return;

	const retries = failedUnits(run.units, run.assignments);

	if (retries.length === 0 || !canLaunchInvestigation(run.investigationDeadline, run.budget)) return;

	for (const retry of retries) {
		run.events?.onLog?.(`${retry.unit.title} failed: ${retry.error}`, {
			assignmentId: retry.unit.id,
			role: 'reviewer'
		});
	}

	reportRetries(retries, run.events);
	run.retriesDone = true;

	const units = retries.map((retry) => retry.unit);

	for (const unit of units) {
		const record = unitRecord(unit);

		run.units.push(unit);
		assignCoverage(run.coverage, unit, 'reviewer');
		run.assignments.push(record);
		run.events?.onAssignment?.(record);
	}

	publishUnits(run, 2);
	await runUnitPool(units, run.assignments, poolContext(run));
}
