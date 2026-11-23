import { findingTier, type Finding, type ReviewAssignment } from '@recoder/shared';

import { isOpenFinding } from '../api/reviews';
import { counted, countFound, type FoundCounts } from '../bugs/tiers';
import type { GuidePart } from './types';

/** Subagents follow up one question; they are not a part of the change to read. */
function isPart(assignment: ReviewAssignment): boolean {
	return assignment.role !== 'subagent';
}

/** Open findings that ask for something, so not FYI notes. */
function askingFindings(findings: Finding[]): Finding[] {
	return findings.filter((finding) => isOpenFinding(finding) && findingTier(finding) !== 'fyi');
}

/** Open findings per file by what they are, FYI notes left out. */
export function openBugsByFile(findings: Finding[]): Map<string, FoundCounts> {
	const byFile = Map.groupBy(askingFindings(findings), (finding) => finding.file);

	return new Map([...byFile].map(([file, found]) => [file, countFound(found.map(counted))]));
}

/**
 * The review plan's parts in plan order, each with its files and the open
 * findings in them. Empty until the review planned. Later copies of an
 * assignment replace earlier ones.
 */
export function guideParts(assignments: ReviewAssignment[] | undefined, findings: Finding[]): GuidePart[] {
	const latest = [...new Map((assignments ?? []).map((assignment) => [assignment.id, assignment])).values()];
	const asking = askingFindings(findings);

	return latest.filter(isPart).map((assignment) => {
		const paths = [...new Set(assignment.scope.map((scope) => scope.path))];

		return {
			id: assignment.id,
			title: assignment.title,
			reason: assignment.reason,
			paths,
			found: countFound(asking.filter((finding) => paths.includes(finding.file)).map(counted))
		};
	});
}
