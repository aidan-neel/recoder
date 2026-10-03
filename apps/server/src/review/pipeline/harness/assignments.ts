import type { AssignmentStatus, ReviewAssignment } from '@recoder/shared';
import type { CoverageLedger } from '../coverage.js';
import type { ReviewUnit } from '../units.js';

/** Assignments whose work a resumed review keeps. */
export const FINISHED: ReadonlySet<AssignmentStatus> = new Set(['done']);

/** The record for an assignment id; every launched item has one. */
export function recordFor(records: ReviewAssignment[], id: string): ReviewAssignment {
	return records.find((record) => record.id === id)!;
}

/** Patches a record in place and recomputes its elapsed time once it completes. */
export function updateAssignment(records: ReviewAssignment[], id: string, patch: Partial<ReviewAssignment>): void {
	const index = records.findIndex((record) => record.id === id);

	if (index < 0) return;

	records[index] = { ...records[index], ...patch };

	const record = records[index];

	if (record.completedAt && (record.startedAt || record.queuedAt)) {
		record.elapsedMs = Math.max(0, Date.parse(record.completedAt) - Date.parse(record.startedAt ?? record.queuedAt!));
	}
}

/** Marks every hunk in the unit's scope as owned by its reviewer. */
export function assignCoverage(coverage: CoverageLedger, unit: ReviewUnit, role: string): void {
	for (const scope of unit.scope) {
		for (const hunkId of scope.hunkIds) coverage.assign(hunkId, scope.path, role);
	}
}

/** Reviewers that ended in an error, one per unit: a retry stands in for the attempt it replaced. */
export function unfinishedAssignments(records: ReviewAssignment[]): ReviewAssignment[] {
	const retried = (record: ReviewAssignment) =>
		records.some((other) => other.id !== record.id && other.id.startsWith(`retry-${record.id}`));

	return records.filter((record) => record.status === 'error' && !retried(record));
}
