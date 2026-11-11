import type { CoverageGap, FindingSeverity } from '@recoder/shared';
import type { ReportFinding, ReportSettings, ReportTarget, ReviewReport } from '../report/report.js';
import { inlineCode } from './markdown-code.js';
import { renderFinding } from './markdown-finding.js';
import { SEVERITIES } from './severity.js';

const SHORT_SHA_LENGTH = 7;

const MS_PER_SECOND = 1000;

/** The report as a document to read top to bottom: outcome, target, settings, counts, findings, then what is left to check. */
export function renderMarkdown(report: ReviewReport): string {
	const blocks = [
		renderHeader(report),
		renderFindings('Findings', report.findings),
		renderFindings('Unconfirmed findings', report.unconfirmed),
		renderList(
			'Recommended checks',
			report.recommendedChecks.map((check) => inlineCode(check))
		),
		renderList('Coverage gaps', report.coverageGaps.map(describeGap))
	];

	return blocks.filter((block) => block !== null).join('\n\n');
}

/** Outcome and summary, then one line each for the target, the settings, the counts and the coverage. */
function renderHeader(report: ReviewReport): string {
	const lead = [
		`# Recoder review: ${report.outcome}`,
		report.summary.trim(),
		report.error ? `Error: ${report.error}` : null
	];

	const facts = [
		`- Target: ${describeTarget(report.target)}`,
		`- Settings: ${describeSettings(report.settings)}`,
		`- Findings: ${countBySeverity(report.findings)}`,
		`- Unconfirmed: ${report.unconfirmed.length}`,
		`- Coverage: ${describeCoverage(report)}`,
		`- Duration: ${(report.durationMs / MS_PER_SECOND).toFixed(1)}s`
	];

	return [...lead.filter((line) => line !== null && line !== ''), facts.join('\n')].join('\n\n');
}

/** The kind of target, its refs and commits, the pull request address and how many files changed. */
function describeTarget(target: ReportTarget): string {
	const refs = target.base || target.head ? ` ${target.base ?? 'default branch'}...${target.head ?? 'HEAD'}` : '';

	const parts = [
		`${target.kind}${refs}`,
		target.headSha ? `head ${target.headSha.slice(0, SHORT_SHA_LENGTH)}` : null,
		target.url,
		target.repoPath,
		`${target.changedFiles} changed files`
	];

	return parts.filter((part) => part !== null).join(', ');
}

/** The settings the review ran with; a setting left to the saved default is not named. */
function describeSettings(settings: ReportSettings): string {
	const parts = [
		`budget ${settings.budget}`,
		`subagents ${settings.subagents}`,
		settings.reviewerModel ? `reviewer ${settings.reviewerModel}` : null,
		settings.workerModel ? `worker ${settings.workerModel}` : null,
		settings.reviewerEffort ? `reviewer effort ${settings.reviewerEffort}` : null,
		settings.workerEffort ? `worker effort ${settings.workerEffort}` : null,
		settings.lenses ? `lenses ${settings.lenses.join(', ')}` : 'all lenses',
		`low severity ${settings.reportLowSeverity ? 'on' : 'off'}`,
		settings.exec ? 'exec on' : `exec off${settings.execReason ? ` (${settings.execReason})` : ''}`
	];

	return parts.filter((part) => part !== null).join(', ');
}

/** `2 error, 1 warning, 0 info`, most severe first. */
function countBySeverity(findings: ReportFinding[]): string {
	const count = (severity: FindingSeverity): string =>
		`${findings.filter((finding) => finding.severity === severity).length} ${severity}`;

	return [...SEVERITIES].reverse().map(count).join(', ');
}

/** How much of the change was read. */
function describeCoverage(report: ReviewReport): string {
	const { reviewed, partial, pending, excluded, total } = report.coverage;

	return `${reviewed} of ${total} reviewed, ${partial} partial, ${pending} pending, ${excluded} excluded`;
}

/** A section of findings; null when there are none, so an empty heading is never printed. */
function renderFindings(heading: string, findings: ReportFinding[]): string | null {
	if (findings.length === 0) return null;

	return [`## ${heading}`, ...findings.map(renderFinding)].join('\n\n');
}

/** A section as a bulleted list; null when there are no items. */
function renderList(heading: string, items: string[]): string | null {
	if (items.length === 0) return null;

	return `## ${heading}\n\n${items.map((item) => `- ${item}`).join('\n')}`;
}

/** `path (state): reason`. */
function describeGap(gap: CoverageGap): string {
	return `${gap.path} (${gap.state}): ${gap.reason}`;
}
