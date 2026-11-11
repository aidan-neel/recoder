import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseReviewArgs } from '../../../src/cli/args/review-args';
import { CliError, EXIT, type ExitCode } from '../../../src/cli/exit';
import { runRecordedReview, type ReviewRunner } from '../../../src/cli/runs/recorded-review';
import { takeOverRun } from '../../../src/cli/runs/review-command';
import type { RunId } from '../../../src/cli/runs/run-id';
import { runFiles } from '../../../src/cli/runs/run-files';
import { exitOnSignal } from '../../../src/cli/signals/exit-on-signal';
import { whenFileExists } from '../../helpers/when-found';
import { report } from '../output/fixtures';
import { destination } from '../output/fixtures';

/** Ends a fixture if a test fails to, so it never outlives the suite. */
export const LIFETIME_MS = 60_000;

/**
 * How the fake background review behaves. `gate`: it says it is waiting, then takes the run over only once the test
 * opens the gate. `stuck-output`: its report is written to a reader that never takes it. Otherwise it runs until it
 * is cancelled.
 */
const FAKE_REVIEW_MODES = ['gate', 'stuck-output', 'until-cancelled'] as const;

export type FakeReviewMode = (typeof FAKE_REVIEW_MODES)[number];

export function isFakeReviewMode(value: string | undefined): value is FakeReviewMode {
	return FAKE_REVIEW_MODES.some((mode) => mode === value);
}

/** The file a gated review writes once it waits, in the run's folder. */
export function waitingFile(runId: RunId): string {
	return join(runFiles(runId).folder, 'waiting');
}

/** Lets a gated review take its run over. */
export function openGate(runId: RunId): void {
	writeFileSync(gateFile(runId), '');
}

function gateFile(runId: RunId): string {
	return join(runFiles(runId).folder, 'gate');
}

/**
 * The background side of `recoder review --detach` with the real takeover and recording, and a review that never
 * calls a model. `flags` are the background process's flags, the run id among them.
 */
export async function runFakeBackgroundReview(flags: string[], mode: FakeReviewMode): Promise<ExitCode> {
	const { launch, options } = parseReviewArgs(flags, process.cwd(), 'program');

	if (launch.kind !== 'background') throw new Error('the fake review runs only as a background review');

	if (mode === 'gate') await untilGateOpens(launch.runId);

	const { journal, signal } = await takeOverRun(launch.runId);
	const isStuck = mode === 'stuck-output';

	return runRecordedReview({
		options,
		journal,
		signal,
		progress: () => {},
		loadRunner: async () => (isStuck ? reportAtOnce : untilCancelled),
		destination: isStuck ? STUCK_READER : SILENT,
		onEndRecorded: exitOnSignal
	}).catch(exitCodeOf);
}

/** The exit code a command's failure ends the process with, as the command line reports it. */
export function exitCodeOf(error: unknown): ExitCode {
	return error instanceof CliError ? error.exitCode : EXIT.failed;
}

const SILENT = destination();

/** A reader that never takes the report; the write keeps the process alive, as a pending pipe write does. */
const STUCK_READER = destination({ writeStdout: () => new Promise(() => setInterval(() => {}, LIFETIME_MS)) });

function untilGateOpens(runId: RunId): Promise<void> {
	writeFileSync(waitingFile(runId), '');

	return whenFileExists(gateFile(runId));
}

async function reportAtOnce(): ReturnType<ReviewRunner> {
	return report();
}

/** A review that reports one stage and then runs until it is cancelled, as the real one does on SIGTERM. */
function untilCancelled(...[, progress, reviewSignal]: Parameters<ReviewRunner>): ReturnType<ReviewRunner> {
	progress({ type: 'stage', stage: 'reviewing' });

	return new Promise((_resolve, reject) => {
		const keepAlive = setInterval(() => {}, LIFETIME_MS);

		const cancel = (): void => {
			clearInterval(keepAlive);
			reject(new CliError('The review was cancelled.', EXIT.cancelled));
		};

		if (reviewSignal.aborted) cancel();
		else reviewSignal.addEventListener('abort', cancel, { once: true });
	});
}
