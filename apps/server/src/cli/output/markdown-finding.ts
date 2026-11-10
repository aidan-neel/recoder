import type { FindingPatch, FindingVerification } from '@recoder/shared';
import type { ReportFinding } from '../report/report.js';
import { fenceBlock, inlineCode } from './markdown-code.js';

/** A finding as a section: heading, message, how it was checked, the suggestion and the patch. */
export function renderFinding(finding: ReportFinding): string {
	const sections = [
		`### ${finding.severity}: ${findingTitle(finding)} (${inlineCode(findingLocation(finding))})`,
		finding.message.trim(),
		renderVerification(finding.verification),
		finding.suggestion ? `Suggestion: ${finding.suggestion.trim()}` : null,
		finding.patch ? renderPatch(finding.patch) : null
	];

	return sections.filter((section) => section !== null).join('\n\n');
}

/** The finding's own title, else its category, so a heading is never empty. */
function findingTitle(finding: ReportFinding): string {
	return finding.title?.trim() || finding.category || 'Finding';
}

/** `file`, `file:12` or `file:12-14`. */
function findingLocation(finding: ReportFinding): string {
	if (finding.line === undefined) return finding.file;

	const end = finding.endLine !== undefined && finding.endLine > finding.line ? `-${finding.endLine}` : '';

	return `${finding.file}:${finding.line}${end}`;
}

/** Whether the finding was proven and how, with the command that proved it. */
function renderVerification(verification: FindingVerification | undefined): string {
	if (!verification) return 'Verification: not recorded.';

	const how = verification.method ? ` by ${verification.method}` : '';
	const reason = verification.reason.trim();
	const text = `Verification: ${verification.status}${how}.${reason ? ` ${reason}` : ''}`;

	return verification.command ? `${text}\n\nCommand: ${inlineCode(verification.command)}` : text;
}

/** The checked diff, and the commands that passed with it applied. */
function renderPatch(patch: FindingPatch): string {
	const checks =
		patch.checks.length > 0 ? `Checks passed with the patch: ${patch.checks.map(inlineCode).join(', ')}.\n\n` : '';

	return `Patch:\n\n${checks}${fenceBlock(patch.diff, 'diff')}`;
}
