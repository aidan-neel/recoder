import { describeError } from '../exit.js';
import { openLiveProgress, type LiveProgress } from '../output/live-progress.js';
import { writeStderrLine } from '../output/streams.js';
import { tildePath } from '../terminal/home-path.js';
import { ProgressFileReader } from './progress-file.js';
import { runFiles } from './run-files.js';
import { shortRunId } from './run-reference.js';
import { readRunStatus, type RunStatus } from './run-status.js';
import { targetLabel } from './run-view.js';
import { waitForRun, type WaitClock, type WaitRequest } from './wait-for-run.js';

/** How often the run's progress file is read for new events: often enough that the view feels live. */
const PROGRESS_POLL_MS = 250;

/**
 * Waits for a run as `waitForRun` does, and meanwhile shows its progress on the terminal, read from the progress file
 * the run writes. A run that has already ended is returned at once with no view.
 */
export async function followRun(request: WaitRequest): Promise<RunStatus> {
	const status = await readRunStatus(request.runId);

	if (status.state !== 'running') return status;

	const view = openLiveProgress({
		title: `Review ${shortRunId(status.runId)} of ${targetLabel(status.targetKind)} in ${tildePath(status.repoPath)}`,
		hint: 'ctrl-c stops watching, the review goes on',
		startedAt: Date.parse(status.startedAt)
	});

	const ended = new AbortController();
	const reader = new ProgressFileReader(runFiles(request.runId).progress);
	const showing = showProgress(reader, view, { clock: request.clock, signal: ended.signal });

	try {
		return await waitForRun(request);
	} finally {
		ended.abort();
		await showing;
		view.close();
	}
}

/**
 * Feeds the view what the run records until `signal` aborts. A progress file that cannot be read ends the feed with
 * one line saying so; the wait itself goes on, since the run's record still tells when it ends.
 */
async function showProgress(
	reader: ProgressFileReader,
	view: LiveProgress,
	until: { clock: WaitClock; signal: AbortSignal }
): Promise<void> {
	while (!until.signal.aborted) {
		try {
			for (const { event, at } of await reader.readNew()) view.advance(event, at);
		} catch (error) {
			writeStderrLine(`recoder: cannot read the run's progress: ${describeError(error)}`);

			return;
		}

		await until.clock.sleep(PROGRESS_POLL_MS, until.signal);
	}
}
