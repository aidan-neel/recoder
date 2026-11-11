import type { ReportFinding } from '../report/report.js';

/** The finding's own title, else its category, so a heading is never empty. */
export function findingTitle(finding: ReportFinding): string {
	return finding.title?.trim() || finding.category || 'Finding';
}

/** `file`, `file:12` or `file:12-14`. */
export function findingLocation(finding: ReportFinding): string {
	if (finding.line === undefined) return finding.file;

	const end = finding.endLine !== undefined && finding.endLine > finding.line ? `-${finding.endLine}` : '';

	return `${finding.file}:${finding.line}${end}`;
}
