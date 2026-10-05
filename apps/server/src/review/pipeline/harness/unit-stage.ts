import { canLaunchInvestigation } from '../agent-loop.js';
import { lensAssignments } from '../lenses/lenses.js';
import { partitionUnits, unitRecord } from '../units.js';
import { FINISHED, assignCoverage } from './assignments.js';
import { poolContext, publishUnits, type ReviewRun } from './context.js';
import { runUnitPool } from './pool.js';
import { failedUnits, reportRetries } from './retries.js';

/**
 * Cuts the change into review units and fans each out into one assignment per
 * lens that applies to it, or restores a resumed review's assignments, and
 * records a queued assignment for each. The model-call budget and deadline
 * were already scaled to the assignment count when the run was created.
 */
export function cutUnits(run: ReviewRun): void {
	const resume = run.input.resume ?? null;

	if (resume) restoreUnits(run);
	else {
		run.units = lensAssignments(partitionUnits(run.inventory));

		for (const unit of run.units) {
			assignCoverage(run.coverage, unit);
			run.assignments.push(unitRecord(unit));
		}
	}

	publishUnits(run, 1);
}

/**
 * Picks a resumed review up from its checkpoint: finished lens assignments and
 * subagents keep their records, the rest are queued again.
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

/**
 * Reruns the lens assignments that failed, once, adjusted for how each failed;
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
		assignCoverage(run.coverage, unit);
		run.assignments.push(record);
		run.events?.onAssignment?.(record);
	}

	publishUnits(run, 2);
	await runUnitPool(units, run.assignments, poolContext(run));
}
