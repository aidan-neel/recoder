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

/** Open suggestions (quality findings) per file: the part of `openBugsByFile` that is no bug. */
export function openSuggestionsByFile(findings: Finding[]): Map<string, number> {
	return openBugsByFile(findings.filter((finding) => finding.kind === 'quality'));
}

/** Open findings per file, all of them and the suggestions among them. */
export interface FileFindings {
	bugs: ReadonlyMap<string, number>;
	suggestions: ReadonlyMap<string, number>;
}

/**
 * The review plan's parts in plan order, each with its files and the open
 * findings in them. Empty until the review planned. Later copies of an
 * assignment replace earlier ones.
 */
export function guideParts(assignments: ReviewAssignment[] | undefined, found: FileFindings): GuidePart[] {
	const latest = [...new Map((assignments ?? []).map((assignment) => [assignment.id, assignment])).values()];

	return latest.filter(isPart).map((assignment) => {
		const paths = [...new Set(assignment.scope.map((scope) => scope.path))];

		const countIn = (counts: ReadonlyMap<string, number>) =>
			paths.reduce((sum, path) => sum + (counts.get(path) ?? 0), 0);

		return {
			id: assignment.id,
			title: assignment.title,
			reason: assignment.reason,
			paths,
			bugs: countIn(found.bugs),
			suggestions: countIn(found.suggestions)
		};
	});
}
