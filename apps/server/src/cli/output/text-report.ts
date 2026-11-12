import type { CoverageGap, FindingSeverity } from '@recoder/shared';
import type { ReportFinding, ReportSettings, ReportTarget, ReviewReport } from '../report/report.js';
import { shortSha } from '../short-sha.js';
import { formatDuration } from '../terminal/duration.js';
import { tildePath } from '../terminal/home-path.js';
import { sectionRule } from '../terminal/layout.js';
import { textWidth, type Surface } from '../terminal/surface.js';
import { indent, plural, wrapText } from '../terminal/text.js';
import { SEVERITIES } from './severity.js';
import { sinceLabel } from './target-since.js';
import { findingLines, severityPaint } from './text-finding.js';
import { prose } from './text-prose.js';

const MARGIN = 2;

const FACT_INDENT = 4;

const BULLET = '- ';

/** The report laid out for a terminal: the outcome, what was reviewed, the summary, each finding, then what is left to do. */
export function renderTextReport(report: ReviewReport, surface: Surface): string {
	const width = textWidth(surface, MARGIN * 2);

	const sections = [
		header(report, surface),
		prose(report.summary, width, surface),
		findingsSection('Findings', report.findings, width, surface),
		findingsSection('Unconfirmed', report.unconfirmed, width, surface),
		listSection(
			'Before you merge',
			report.recommendedChecks.flatMap((check) => bulletLines(check, width, surface)),
			width,
			surface
		),
		listSection(
			'Not reviewed',
			report.coverageGaps.flatMap((gap) => gapLines(gap, width, surface)),
			width,
			surface
		)
	];

	const body = sections.filter((section) => section.length > 0).flatMap((section) => [...section, '']);

	return ['', ...indent(body, MARGIN), ''].join('\n');
}

/** The outcome with the counts and the time it took, the error of a review that stopped, then what it reviewed and how. */
function header(report: ReviewReport, surface: Surface): string[] {
	const { paint, glyphs } = surface;
	const facts = [outcomeMark(report, surface), countsPhrase(report, surface), formatDuration(report.durationMs)];
	const errorPaint = report.outcome === 'failed' ? paint.error : paint.muted;
	const error = report.error ? wrapText(report.error, textWidth(surface, FACT_INDENT)).map(errorPaint) : [];

	return [
		facts.join(paint.muted(` ${glyphs.separator} `)),
		...indent(error, FACT_INDENT - MARGIN),
		'',
		...indent(
			[describeTarget(report, surface), describeSettings(report.settings, surface)]
				.flatMap((fact) => wrapText(fact, textWidth(surface, FACT_INDENT)))
				.map(paint.muted),
			FACT_INDENT - MARGIN
		)
	];
}

function outcomeMark(report: ReviewReport, { paint, glyphs }: Surface): string {
	if (report.outcome === 'complete') return paint.strong(paint.ok(`${glyphs.ok} Review complete`));

	if (report.outcome === 'cancelled') return paint.strong(paint.warning(`${glyphs.warn} Review cancelled`));

	return paint.strong(paint.error(`${glyphs.fail} Review failed`));
}

/** `2 errors, 1 warning`, most severe first and each in its color; `no findings` when there are none. */
function countsPhrase(report: ReviewReport, surface: Surface): string {
	const counts = [...SEVERITIES]
		.reverse()
		.map((severity) => ({ severity, count: countOf(report.findings, severity) }))
		.filter(({ count }) => count > 0)
		.map(({ severity, count }) => severityPaint(severity, surface)(plural(count, severity)));

	const unconfirmed = report.unconfirmed.length > 0 ? [`${report.unconfirmed.length} unconfirmed`] : [];
	const all = [...counts, ...unconfirmed];

	return all.length > 0 ? all.join(', ') : 'no findings';
}

function countOf(findings: readonly ReportFinding[], severity: FindingSeverity): number {
	return findings.filter((finding) => finding.severity === severity).length;
}

/** What was reviewed: the refs or the kind of change, the repository, and how much of it was read. */
function describeTarget(report: ReviewReport, { glyphs }: Surface): string {
	const { target, coverage } = report;

	const parts = [
		targetName(target, glyphs.arrow),
		target.headSha ? shortSha(target.headSha) : null,
		sinceLabel(target),
		target.repoPath ? tildePath(target.repoPath) : null,
		`${coverage.reviewed} of ${plural(coverage.total, 'file')} reviewed`
	];

	return parts.filter((part) => part !== null).join(` ${glyphs.separator} `);
}

function targetName(target: ReportTarget, arrow: string): string {
	if (target.kind === 'pull') return target.url ?? 'pull request';

	if (target.kind === 'staged') return 'staged changes';

	if (target.kind === 'uncommitted') return 'uncommitted changes';

	if (target.kind === 'diff') return 'diff file';

	return `${target.head ?? 'HEAD'} ${arrow} ${target.base ?? 'default branch'}`;
}

/** How the review ran: the budget, the models, and whether code could run. */
function describeSettings(settings: ReportSettings, { glyphs }: Surface): string {
	const parts = [
		`${settings.budget} budget`,
		settings.reviewerModel ? `reviewer ${settings.reviewerModel}` : null,
		settings.workerModel && settings.workerModel !== settings.reviewerModel ? `worker ${settings.workerModel}` : null,
		settings.verifierModel && settings.verifierModel !== settings.reviewerModel
			? `verifier ${settings.verifierModel}`
			: null,
		settings.exec ? 'code ran in the sandbox' : `no code ran${settings.execReason ? ` (${settings.execReason})` : ''}`
	];

	return parts.filter((part) => part !== null).join(` ${glyphs.separator} `);
}

/** A titled run of findings with a blank line between them; nothing when there are none. */
function findingsSection(title: string, findings: readonly ReportFinding[], width: number, surface: Surface): string[] {
	if (findings.length === 0) return [];

	const blocks = findings.flatMap((finding) => ['', ...findingLines(finding, surface)]);

	return [sectionRule(`${title} (${findings.length})`, width, surface), ...blocks];
}

function listSection(title: string, lines: readonly string[], width: number, surface: Surface): string[] {
	if (lines.length === 0) return [];

	return [sectionRule(title, width, surface), '', ...lines];
}

/** One item of a list, wrapped under its bullet. The checks a review recommends are sentences as often as commands. */
function bulletLines(text: string, width: number, surface: Surface): string[] {
	const [first = '', ...rest] = prose(text, width - BULLET.length, surface);

	return [`${surface.paint.muted(BULLET)}${first}`, ...indent(rest, BULLET.length)];
}

/** A path that was not fully read, and why. */
function gapLines(gap: CoverageGap, width: number, surface: Surface): string[] {
	const reason = wrapText(gap.reason, width - MARGIN).map(surface.paint.muted);

	return [`${gap.path} ${surface.paint.warning(gap.state)}`, ...indent(reason, MARGIN)];
}
