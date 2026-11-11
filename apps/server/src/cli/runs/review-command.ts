import type { ReviewRequest } from '../args/review-args.js';
import { backgroundFlags } from '../args/launch.js';
import { CliError, EXIT, loadOrNotReady, type ExitCode } from '../exit.js';
import { prepareOutputFile, processDestination } from '../output/deliver.js';
import { printResult } from '../output/print-result.js';
import { writeStderrLine } from '../output/streams.js';
import type { ReviewOptions } from '../review/options.js';
import { selfCommand } from '../self-command.js';
import { abortOnSignal } from '../signals/abort-on-signal.js';
import { exitOnSignal } from '../signals/exit-on-signal.js';
import { STOP_SIGNALS, outliveHangUp } from '../signals/shutdown-signals.js';
import { withSpinner } from '../terminal/spinner.js';
import type { Terminal } from '../terminal/terminal.js';
import { HANDOVER_TIMEOUT_MS, detachReview, spawnDetached } from './detach.js';
import { runRecordedReview, type ReviewRunner } from './recorded-review.js';
import { pruneFinishedRuns } from './retention.js';
import type { RunId } from './run-id.js';
import { RunJournal, type NewRun } from './run-journal.js';
import { shortRunId } from './run-reference.js';
import type { RunStatus } from './run-status.js';
import { detachedView } from './run-view.js';
import { showProgress } from './shown-progress.js';
import { isStopRequested } from './stop-request.js';

/** A run this process is responsible for, and the signal that stops its review. */
interface OwnedRun {
	journal: RunJournal;
	signal: AbortSignal;
}

/** `recoder review`: every review is a recorded run, whether it runs here, starts in the background, or is that run. */
export async function runReviewCommand(request: ReviewRequest, terminal: Terminal): Promise<ExitCode> {
	const { options, launch } = request;

	if (launch.kind === 'detach') return startDetached(options, launch.flags, terminal);

	const { journal, signal } =
		launch.kind === 'background' ? await takeOverRun(launch.runId) : await startForeground(options);

	const shown = showProgress({ options, runId: journal.runId, stop: signal }, terminal);

	try {
		const exitCode = await runRecordedReview({
			options,
			journal,
			signal,
			progress: shown.sink,
			loadRunner: loadReviewRunner,
			destination: processDestination(terminal),
			onEndRecorded: () => {
				shown.close();
				exitOnSignal();
			}
		});

		if (terminal.audience === 'person' && launch.kind === 'foreground') noteRun(journal.runId, terminal);

		return exitCode;
	} finally {
		shown.close();
	}
}

/** Tells a person how to read the report they just got again; a program already has the run id from the first line. */
function noteRun(runId: RunId, { err }: Terminal): void {
	const note = `Saved as run ${runId} ${err.glyphs.separator} recoder result ${shortRunId(runId)} prints it again`;

	writeStderrLine(`  ${err.paint.muted(note)}\n`);
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
 * The background process is this same program running `recoder review` with the caller's flags. For a program the
 * status line is printed whatever happened, so a caller that reads it always gets the run id, the error and the log
 * file; a person gets the run and what to do next, or the error of a run that did not start. A run that did not
 * start exits as failed; a SIGINT or SIGTERM received while starting, as cancelled. A hang-up cancels nothing: the
 * background process runs in its own session to outlive a closing terminal, so this one finishes handing the run
 * over too.
 */
async function startDetached(options: ReviewOptions, flags: string[], terminal: Terminal): Promise<ExitCode> {
	outliveHangUp();

	const signal = abortOnSignal(STOP_SIGNALS);

	if (options.output.file !== null) await prepareOutputFile(options.output.file);

	const run = await withSpinner('Starting the review in the background', terminal, () =>
		detachReview({
			run: newRunOf(options),
			command: (runId) => [...selfCommand(Bun.main), 'review', ...backgroundFlags(runId, flags)],
			signal,
			handoverTimeoutMs: HANDOVER_TIMEOUT_MS,
			spawn: spawnDetached
		})
	);

	if (terminal.audience === 'program' || run.outcome !== 'not-started') {
		await printResult(terminal, run.status, (_, surface) => detachedView(run, surface));
	}

	if (run.outcome === 'not-started') throw notStarted(run.status);

	return run.outcome === 'cancelled' || signal.aborted ? EXIT.cancelled : EXIT.ok;
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
