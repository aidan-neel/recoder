import type { ReviewRequest } from '../args/review-args.js';
import { backgroundFlags } from '../args/launch.js';
import { CliError, EXIT, loadOrNotReady, type ExitCode } from '../exit.js';
import { PROCESS_DESTINATION, prepareOutputFile } from '../output/deliver.js';
import { writeStderrLine } from '../output/streams.js';
import type { ReviewOptions } from '../review/options.js';
import { abortOnSignal } from '../signals/abort-on-signal.js';
import { exitOnSignal } from '../signals/exit-on-signal.js';
import { STOP_SIGNALS, outliveHangUp } from '../signals/shutdown-signals.js';
import { HANDOVER_TIMEOUT_MS, detachReview, spawnDetached } from './detach.js';
import { writeJsonLine } from './json-line.js';
import { runRecordedReview, type ReviewRunner } from './recorded-review.js';
import { pruneFinishedRuns } from './retention.js';
import type { RunId } from './run-id.js';
import { RunJournal, type NewRun } from './run-journal.js';
import type { RunStatus } from './run-status.js';
import { isStopRequested } from './stop-request.js';

/** A run this process is responsible for, and the signal that stops its review. */
interface OwnedRun {
	journal: RunJournal;
	signal: AbortSignal;
}

/** `recoder review`: every review is a recorded run, whether it runs here, starts in the background, or is that run. */
export async function runReviewCommand(request: ReviewRequest): Promise<ExitCode> {
	const { options, launch } = request;

	if (launch.kind === 'detach') return startDetached(options, launch.flags);

	const { journal, signal } =
		launch.kind === 'background' ? await takeOverRun(launch.runId) : await startForeground(options);

	if (options.output.progress === 'text') writeStderrLine(`run: ${journal.runId}`);

	return runRecordedReview({
		options,
		journal,
		signal,
		loadRunner: loadReviewRunner,
		destination: PROCESS_DESTINATION,
		onEndRecorded: exitOnSignal
	});
}

/**
 * The background side of `--detach`. Its signal handling comes first, so a stop the launcher passes on after the
 * takeover is handled. A cancel whose signal reached only the launcher left its request in the run's folder, read
 * here after the takeover; that request stops the review without counting as a signal, so a signal the launcher did
 * pass on as well is still the first and the review cleans up.
 */
export async function takeOverRun(runId: RunId): Promise<OwnedRun> {
	const stop = abortOnSignal();
	const journal = await RunJournal.takeOver(runId);
	const signal = (await isStopRequested(runId)) ? AbortSignal.any([stop, AbortSignal.abort()]) : stop;

	return { journal, signal };
}

/** Checks `--output` before the run exists, as a foreground review always has, so a bad path starts nothing. */
async function startForeground(options: ReviewOptions): Promise<OwnedRun> {
	const signal = abortOnSignal();

	if (options.output.file !== null) await prepareOutputFile(options.output.file);

	await pruneFinishedRuns();

	return { journal: await RunJournal.create(newRunOf(options)), signal };
}

/**
 * The background process is this same program running `recoder review` with the caller's flags. The status line is
 * printed whatever happened, so a caller that reads it always gets the run id, the error and the log file. A run that
 * did not start exits as failed; a SIGINT or SIGTERM received while starting, as cancelled. A hang-up cancels
 * nothing: the background process runs in its own session to outlive a closing terminal, so this one finishes
 * handing the run over too.
 */
async function startDetached(options: ReviewOptions, flags: string[]): Promise<ExitCode> {
	outliveHangUp();

	const signal = abortOnSignal(STOP_SIGNALS);

	if (options.output.file !== null) await prepareOutputFile(options.output.file);

	const { status, outcome } = await detachReview({
		run: newRunOf(options),
		command: (runId) => [process.execPath, Bun.main, 'review', ...backgroundFlags(runId, flags)],
		signal,
		handoverTimeoutMs: HANDOVER_TIMEOUT_MS,
		spawn: spawnDetached
	});

	await writeJsonLine(status);

	if (outcome === 'not-started') throw notStarted(status);

	return outcome === 'cancelled' || signal.aborted ? EXIT.cancelled : EXIT.ok;
}

function notStarted(status: RunStatus): CliError {
	return new CliError(`run ${status.runId} did not start: ${status.error}. Its log is ${status.logFile}.`, EXIT.failed);
}

function newRunOf(options: ReviewOptions): NewRun {
	return { repoPath: options.repoPath, targetKind: options.target.kind };
}

/** Loads the pipeline only now, so help, usage errors and the other run commands never touch it. */
async function loadReviewRunner(): Promise<ReviewRunner> {
	const { runReview } = await loadOrNotReady(() => import('../run/run-review.js'));

	return runReview;
}
