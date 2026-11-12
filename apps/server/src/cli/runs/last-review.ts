import { CliError } from '../exit.js';
import type { ReportSettings, ReportTarget, ReviewReport } from '../report/report.js';
import type { RunId } from './run-id.js';
import { runFiles } from './run-files.js';
import { listRunIds } from './run-list.js';
import { readRunRecord } from './run-record.js';
import { readStoredReport } from './stored-report.js';

/** An earlier run that might be the last review of a change: the commits its report says it covered. */
export interface ReviewCandidate {
	runId: RunId;
	headSha: string;
	baseSha: string;
}

/**
 * The runs that could be the last review of a change, newest first. A run is
 * a candidate when its report is complete, covers a commit range or a pull
 * request whole (no `--include`, `--exclude` or `--lens` narrowing) and did
 * not start at a commit the caller named. Whether its commits still fit the
 * change being reviewed is git's question, asked by the caller; a run whose
 * files cannot be read is skipped, as `listRuns` skips an unreadable record.
 */
export async function lastReviewCandidates(): Promise<ReviewCandidate[]> {
	const candidates: ReviewCandidate[] = [];

	for (const runId of await listRunIds()) {
		const candidate = await readCandidate(runId);

		if (candidate !== null) candidates.push(candidate);
	}

	return candidates;
}

async function readCandidate(runId: RunId): Promise<ReviewCandidate | null> {
	const files = runFiles(runId);

	try {
		if ((await readRunRecord(runId, files)) === null) return null;

		const report = await readStoredReport(runId, files);

		return report === null ? null : candidateOf(runId, report);
	} catch (error) {
		if (error instanceof CliError) return null;

		throw error;
	}
}

/** The run as a start candidate, or null when its report rules it out. */
function candidateOf(runId: RunId, report: ReviewReport): ReviewCandidate | null {
	if (report.outcome !== 'complete') return null;

	const { target, settings } = report;

	if (target.kind !== 'range' && target.kind !== 'pull') return null;
	if (!sawWholeChange(settings) || startedAtNamedCommit(target)) return null;
	if (typeof target.headSha !== 'string' || typeof target.baseSha !== 'string') return null;

	return { runId, headSha: target.headSha, baseSha: target.baseSha };
}

/**
 * Whether the report proves the review saw the whole change: no path globs
 * and every lens. A report from before these fields were recorded cannot
 * prove it, so it does not count.
 */
function sawWholeChange(settings: ReportSettings): boolean {
	return settings.include?.length === 0 && settings.exclude?.length === 0 && settings.lenses === null;
}

/** Whether the review started at a commit the caller named, which records no earlier review to continue from. */
function startedAtNamedCommit(target: ReportTarget): boolean {
	return typeof target.since === 'string' && target.sinceRunId === null;
}
