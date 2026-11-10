import { CliError, EXIT, describeError, type ExitCode } from '../exit.js';
import { deliverReport, type ReportDestination } from '../output/deliver.js';
import { exitCodeFor } from '../output/exit-code.js';
import { createProgressSink, teeProgress } from '../output/progress-sink.js';
import { writeStderrLine } from '../output/streams.js';
import type { ProgressSink } from '../progress.js';
import type { ReviewReport } from '../report/report.js';
import type { ReviewOptions } from '../review/options.js';
import { endOfFailure, endOfReport } from './run-end.js';
import type { RunJournal } from './run-journal.js';

/** Runs one review in this process; `run/run-review.ts` is the real one. */
export type ReviewRunner = (
	options: ReviewOptions,
	progress: ProgressSink,
	signal: AbortSignal
) => Promise<ReviewReport>;

/** A review to run under a run's record. */
export interface RecordedReview {
	options: ReviewOptions;
	journal: RunJournal;
	signal: AbortSignal;
	/** Loads the runner. It is loaded after the run exists, so a machine that is not ready is recorded too. */
	loadRunner: () => Promise<ReviewRunner>;
	destination: ReportDestination;
	/** Called once the run's end is recorded; the command line makes one stop end the process from then on. */
	onEndRecorded: () => void;
}

/**
 * Runs the review, saves its report and writes it out as a foreground `recoder review` does, and records how the run
 * ended on every path: a report, a failure before one, or a report that could not be written out.
 */
export async function runRecordedReview(review: RecordedReview): Promise<ExitCode> {
	const report = await produceReport(review);

	return deliverRecordedReport(review, report);
}

async function produceReport(review: RecordedReview): Promise<ReviewReport> {
	const { options, journal, signal } = review;

	try {
		const runner = await review.loadRunner();

		return await runner(options, progressFor(options, journal), signal);
	} catch (error) {
		await journal.finish(endOfFailure(error));

		throw error;
	}
}

/** Progress goes where the caller asked, and always to the run's progress file and record. */
function progressFor(options: ReviewOptions, journal: RunJournal): ProgressSink {
	const shown = createProgressSink(options.output.progress, writeStderrLine, () => new Date());

	return teeProgress([shown, journal.progressSink()]);
}

/**
 * The report is saved and the run's end recorded before the report is written out, so a closed terminal or an
 * unwritable `--output` cannot lose it. From then on nothing is left to cancel, so one stop ends the process at once,
 * even while a slow reader holds the report up. A report that cannot be written out records that failure instead.
 */
async function deliverRecordedReport(review: RecordedReview, report: ReviewReport): Promise<ExitCode> {
	const { options, journal } = review;
	const isSaved = await journal.saveReport(report);
	const exitCode = exitCodeFor(report, options.output);

	await journal.finish(endOfReport(report, { exitCode, error: report.error }));
	review.onEndRecorded();

	try {
		await deliverReport(report, options.output, review.destination);
	} catch (error) {
		const failure = explainDeliveryFailure(error, isSaved ? journal.runId : null);

		await journal.finish(endOfReport(report, { exitCode: failure.exitCode, error: failure.message }));

		throw failure;
	}

	return exitCode;
}

/** Says where the finished review can still be read, when it was saved. */
function explainDeliveryFailure(error: unknown, savedRunId: string | null): CliError {
	const exitCode = error instanceof CliError ? error.exitCode : EXIT.failed;

	if (savedRunId === null) return new CliError(describeError(error), exitCode);

	return new CliError(
		`${describeError(error)}. The review is saved; run recoder result ${savedRunId} to print it.`,
		exitCode
	);
}
