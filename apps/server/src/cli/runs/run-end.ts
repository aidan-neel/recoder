import { CliError, EXIT, describeError, type ExitCode } from '../exit.js';
import type { ReviewReport } from '../report/report.js';
import type { RunRecord, RunState } from './run-record.js';

/** How a run ended, as its record keeps it. */
export interface RunEnd extends Pick<RunRecord, 'error' | 'findings' | 'unconfirmed'> {
	state: Exclude<RunState, 'running'>;
	exitCode: ExitCode;
}

/** The end of a run whose review returned a report: its outcome and counts, and the code the process exits with. */
export function endOfReport(report: ReviewReport, exit: { exitCode: ExitCode; error: string | null }): RunEnd {
	return {
		state: report.outcome,
		exitCode: exit.exitCode,
		error: exit.error,
		findings: report.findings.length,
		unconfirmed: report.unconfirmed.length
	};
}

/** The end of a run that threw before it had a report: a cancel, a usage or not-ready error, or anything else. */
export function endOfFailure(error: unknown): RunEnd {
	const exitCode = error instanceof CliError ? error.exitCode : EXIT.failed;

	return {
		state: exitCode === EXIT.cancelled ? 'cancelled' : 'failed',
		exitCode,
		error: describeError(error),
		findings: null,
		unconfirmed: null
	};
}
