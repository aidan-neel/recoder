import { FINDING_SEVERITIES, type CoverageGap, type Finding } from '@recoder/shared';
import { byCodePoint } from '../../review/pipeline/change-model/repo.js';
import type { AdaptiveReviewResult } from '../../review/pipeline/harness/types.js';
import {
	REPORT_SCHEMA_VERSION,
	type ReportFinding,
	type ReportSettings,
	type ReportTarget,
	type ReviewReport
} from '../report/report.js';

/** What a finished or stopped run hands over to become the report. */
export interface ReportSource {
	result: AdaptiveReviewResult;
	target: ReportTarget;
	settings: ReportSettings;
	/** Why a signal or the timeout stopped the run; null when neither did. */
	stopReason: string | null;
	startedAtMs: number;
	endedAtMs: number;
}

/**
 * The report a calling agent reads. A stop by a signal or the timeout makes the outcome `cancelled` whatever the
 * harness called it; a failed run keeps the findings it had, and says why it failed. A run the harness calls complete
 * that reviewed none of the change is failed too, so a caller that reads the exit code never takes it for a clean
 * change.
 */
export function buildReport(source: ReportSource): ReviewReport {
	const { result, stopReason } = source;
	const unreviewed = stopReason === null ? nothingReviewedError(result) : null;
	const outcome = outcomeOf(result, stopReason, unreviewed);

	return {
		schemaVersion: REPORT_SCHEMA_VERSION,
		outcome,
		summary: unreviewed ?? result.summary,
		error: stopReason ?? unreviewed ?? result.error ?? (outcome === 'failed' ? result.summary : null),
		target: source.target,
		settings: source.settings,
		findings: reportFindings(result.findings),
		unconfirmed: reportFindings(result.unconfirmed),
		recommendedChecks: result.recommendedChecks,
		coverage: result.coverage,
		coverageGaps: result.coverageGaps,
		funnel: result.funnel ?? null,
		questions: result.questions ?? null,
		obligations: result.obligations ?? null,
		startedAt: new Date(source.startedAtMs).toISOString(),
		durationMs: source.endedAtMs - source.startedAtMs
	};
}

function outcomeOf(
	result: AdaptiveReviewResult,
	stopReason: string | null,
	unreviewed: string | null
): ReviewReport['outcome'] {
	if (stopReason !== null) return 'cancelled';

	if (unreviewed !== null) return 'failed';

	return result.outcome;
}

/**
 * Why a complete run reviewed none of the change, or null when it reviewed some of it or had nothing to review.
 * Coverage counts hunks, and excluded hunks (by `--exclude`, a generated file or a summarized lockfile) were never to
 * be reviewed, so an all-excluded change is not a failure. The reason is the one the most gaps give, already in the
 * report's `coverageGaps`.
 */
function nothingReviewedError(result: AdaptiveReviewResult): string | null {
	const { coverage } = result;
	const toReview = coverage.total - coverage.excluded;

	if (result.outcome !== 'complete' || toReview === 0 || coverage.reviewed > 0) return null;

	const reason = mostCommonGapReason(result.coverageGaps);
	const said = 'No part of the change was reviewed.';

	return reason === null ? said : `${said} Most common reason: ${reason}`;
}

function mostCommonGapReason(gaps: CoverageGap[]): string | null {
	const counts = new Map<string, number>();

	for (const gap of gaps) {
		if (gap.state === 'excluded') continue;

		const reason = firstLine(gap.reason);

		if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
	}

	let common: [string, number] | null = null;

	for (const entry of counts) {
		if (common === null || entry[1] > common[1]) common = entry;
	}

	return common?.[0] ?? null;
}

function firstLine(text: string): string {
	return text.split('\n')[0].trim();
}

/** Most severe first (`FINDING_SEVERITIES` lists them least severe first), then by file and line, so the same findings always read in the same order. */
function reportFindings(findings: Finding[]): ReportFinding[] {
	return findings.map(projectFinding).sort(byUrgency);
}

/** Copies exactly the fields the report promises; the pipeline's bookkeeping (agent, model, fingerprint, ids of members and evidence) stays behind. */
function projectFinding(finding: Finding): ReportFinding {
	return {
		id: finding.id,
		title: finding.title,
		file: finding.file,
		line: finding.line,
		endLine: finding.endLine,
		side: finding.side,
		severity: finding.severity,
		message: finding.message,
		suggestion: finding.suggestion,
		category: finding.category,
		kind: finding.kind,
		lens: finding.lens,
		ruleId: finding.ruleId,
		smell: finding.smell,
		symbol: finding.symbol,
		claim: finding.claim,
		patch: finding.patch,
		relatedLocations: finding.relatedLocations,
		verification: finding.verification
	};
}

function byUrgency(a: ReportFinding, b: ReportFinding): number {
	return (
		FINDING_SEVERITIES.indexOf(b.severity) - FINDING_SEVERITIES.indexOf(a.severity) ||
		byCodePoint(a.file, b.file) ||
		(a.line ?? 0) - (b.line ?? 0) ||
		byCodePoint(a.id, b.id)
	);
}
