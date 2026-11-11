import { CliError, EXIT, usageError, type ExitCode } from '../exit.js';
import { deliverReport, prepareOutputFile, processDestination, type ReportDestination } from '../output/deliver.js';
import { exitCodeFor } from '../output/exit-code.js';
import { writeStderrLine } from '../output/streams.js';
import type { OutputOptions } from '../review/options.js';
import type { Terminal } from '../terminal/terminal.js';
import type { RunId } from './run-id.js';
import { runFiles } from './run-files.js';
import { resolveRunReference, type RunReference } from './run-reference.js';
import { readRunStatus, type RunStatus } from './run-status.js';
import { readStoredReport } from './stored-report.js';

const NO_REPORT = 'the run ended without a report.';

/** What a finished run has for its reader: its report, delivered, or the error of a run that ended without one. */
type RunResult = { kind: 'report'; exitCode: ExitCode } | { kind: 'no-report'; error: string; exitCode: ExitCode };

/** `recoder result [run]`. */
export async function runResultCommand(
	run: RunReference,
	output: OutputOptions,
	terminal: Terminal
): Promise<ExitCode> {
	return printRunResult(await resolveRunReference(run), output, processDestination(terminal));
}

/** Writes the report as `deliverRunResult` does, or the error of a run with none on standard error, and its exit code. */
export async function printRunResult(
	runId: RunId,
	output: OutputOptions,
	destination: ReportDestination
): Promise<ExitCode> {
	const result = await deliverRunResult(runId, output, destination);

	if (result.kind === 'no-report') writeStderrLine(`recoder: ${result.error}`);

	return result.exitCode;
}

/**
 * Delivers the saved report as a foreground review would, with the same flags, the same `--output` handling and the
 * same exit codes. A run that ended before it had a report returns its error and the code it ended with; a run that
 * had one which is now missing fails, so an empty answer never reads as a clean review.
 */
export async function deliverRunResult(
	runId: RunId,
	output: OutputOptions,
	destination: ReportDestination
): Promise<RunResult> {
	const status = await readRunStatus(runId);

	if (status.state === 'running') throw usageError(`run ${runId} is still running; run recoder wait ${runId} first.`);

	const report = await readStoredReport(runId, runFiles(runId));

	if (report === null) {
		if (hadReport(status)) throw missingReport(status);

		return { kind: 'no-report', error: status.error ?? NO_REPORT, exitCode: status.exitCode ?? EXIT.failed };
	}

	if (output.file !== null) await prepareOutputFile(output.file);

	await deliverReport(report, output, destination);

	return { kind: 'report', exitCode: exitCodeFor(report, output) };
}

/** A run whose review returned a report records its counts; a run that ended before one leaves them null. */
function hadReport(status: RunStatus): boolean {
	return status.state === 'complete' || status.findings !== null;
}

function missingReport(status: RunStatus): CliError {
	const path = runFiles(status.runId).report;

	return new CliError(`run ${status.runId} finished with a report, but ${path} is missing.`, EXIT.failed);
}
