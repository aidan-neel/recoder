import type { AssignmentStatus, ReviewAssignment } from '@recoder/shared';
import type { CoverageLedger } from '../coverage.js';
import type { PlannerAssignment } from '../planner.js';

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

/** A fresh record for a planned assignment. */
export function toAssignmentRecord(
	item: PlannerAssignment,
	status: ReviewAssignment['status'],
	followUp = false
): ReviewAssignment {
	return {
		id: item.id,
		role: item.role,
		title: item.title,
		reason: item.reason,
		status,
		scope: item.scope,
		questions: item.questions,
		priority: item.priority,
		followUp,
		candidateCount: 0,
		currentOperation: status === 'queued' ? 'Queued for specialist review' : undefined,
		queuedAt: new Date().toISOString()
	};
}

/** Marks every hunk in the assignment's scope as owned by its role. */
export function assignCoverage(coverage: CoverageLedger, item: PlannerAssignment): void {
	for (const scope of item.scope) {
		for (const hunkId of scope.hunkIds) coverage.assign(hunkId, scope.path, item.role);
	}
}

/** Renames follow-ups whose id is already taken, as `follow-<id>`, then `follow-<id>-2` and so on. */
export function uniqueIds(items: PlannerAssignment[], taken: Iterable<string>): PlannerAssignment[] {
	const used = new Set(taken);

	return items.map((item: PlannerAssignment) => {
		let id = item.id;

		if (used.has(id)) id = id.startsWith('follow-') ? id : `follow-${id}`;
		for (let n = 2; used.has(id); n++) id = `${item.id.startsWith('follow-') ? item.id : `follow-${item.id}`}-${n}`;
		used.add(id);

		return id === item.id ? item : { ...item, id };
	});
}

/**
 * Specialists that ended in an error, one per specialist: a retry stands in for
 * the attempt it replaced, and specialists the developer chose not to run aren't failures.
 */
export function unfinishedAssignments(records: ReviewAssignment[]): ReviewAssignment[] {
	const retried = (record: ReviewAssignment) =>
		records.some((other) => other.id !== record.id && other.id.startsWith(`retry-${record.id}`));

	return records.filter((record) => record.status === 'error' && !retried(record));
}
