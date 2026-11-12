import type { Finding, ReviewAssignment } from '@recoder/shared';

import { isOpenFinding } from '../api/reviews';
import type { GuidePart } from './types';

/** Subagents follow up one question; they are not a part of the change to read. */
function isPart(assignment: ReviewAssignment): boolean {
	return assignment.role !== 'subagent';
}

/** Open findings per file. */
export function openBugsByFile(findings: Finding[]): Map<string, number> {
	const counts = new Map<string, number>();

	for (const finding of findings.filter(isOpenFinding)) counts.set(finding.file, (counts.get(finding.file) ?? 0) + 1);

	return counts;
}

/**
 * The review plan's parts in plan order, each with its files and the open
 * findings in them. Empty until the review planned. Later copies of an
 * assignment replace earlier ones.
 */
export function guideParts(
	assignments: ReviewAssignment[] | undefined,
	bugs: ReadonlyMap<string, number>
): GuidePart[] {
	const latest = [...new Map((assignments ?? []).map((assignment) => [assignment.id, assignment])).values()];

	return latest.filter(isPart).map((assignment) => {
		const paths = [...new Set(assignment.scope.map((scope) => scope.path))];

		return {
			id: assignment.id,
			title: assignment.title,
			reason: assignment.reason,
			paths,
			bugs: paths.reduce((sum, path) => sum + (bugs.get(path) ?? 0), 0)
		};
	});
}
