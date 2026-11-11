import type { Subprocess } from 'bun';
import { closeSync, openSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { CliError, EXIT, describeError } from '../exit.js';
import { pruneFinishedRuns } from './retention.js';
import { endOfFailure } from './run-end.js';
import type { RunId } from './run-id.js';
import { PRIVATE_FILE_MODE, runFiles } from './run-files.js';
import { RunJournal, type NewRun } from './run-journal.js';
import { readRunRecord } from './run-record.js';
import { readRunStatus, type RunStatus } from './run-status.js';

/** How long the background process has to start and take the run over before it counts as not started. */
export const HANDOVER_TIMEOUT_MS = 30_000;

const HANDOVER_POLL_MS = 50;

/** Starts the background process with the run's log as its standard error; injected so tests own what they start. */
type BackgroundSpawner = (command: string[], log: number) => Subprocess;

/** A review to start in the background. */
export interface DetachRequest {
	run: NewRun;
	/** The background process's argv for the run it is handed. */
	command: (runId: RunId) => string[];
	/** Aborts when this process is asked to stop; the stop is passed on to the background review. */
	signal: AbortSignal;
	handoverTimeoutMs: number;
	spawn: BackgroundSpawner;
	/** Told the run's id once its record exists, before the handover; the MCP server cancels a start through it. */
	onRunCreated?: (runId: RunId) => void;
}

/**
 * `started`: the background process took the run over, and may since have ended. `not-started`: it exited or ran out
 * of time first. `cancelled`: this process was asked to stop before the handover.
 */
type DetachOutcome = 'started' | 'not-started' | 'cancelled';

export interface DetachedRun {
	status: RunStatus;
	outcome: DetachOutcome;
}

/**
 * Starts a review in a background process and returns once that process has taken the run over, so `recoder status`
 * and `recoder cancel` work as soon as this returns. Until the handover the record names this process, so this process
 * must stop the review when it is signalled: every stop it receives, before or after the handover, is passed on to
 * the child it started.
 */
export async function detachReview(request: DetachRequest): Promise<DetachedRun> {
	await pruneFinishedRuns();

	const journal = await RunJournal.create(request.run);

	request.onRunCreated?.(journal.runId);

	const child = await startBackgroundProcess(journal, request);
	const background = { child, stop: stopperFor(child) };

	request.signal.addEventListener('abort', background.stop, { once: true });

	const outcome = await awaitHandover(journal, background, request);

	return { status: await readRunStatus(journal.runId), outcome };
}

/** The process `recoder review --detach` starts: in its own session (`setsid`), so a closing terminal does not reach it. */
export function spawnDetached(command: string[], log: number): Subprocess {
	const child = Bun.spawn(command, { stdio: ['ignore', 'ignore', log], detached: true, env: process.env });

	child.unref();

	return child;
}

async function startBackgroundProcess(journal: RunJournal, request: DetachRequest): Promise<Subprocess> {
	const log = openSync(runFiles(journal.runId).log, 'a', PRIVATE_FILE_MODE);

	try {
		return request.spawn(request.command(journal.runId), log);
	} catch (error) {
		const failure = new CliError(`cannot start the background review: ${describeError(error)}`, EXIT.failed);

		await journal.finish(endOfFailure(failure));

		throw failure;
	} finally {
		closeSync(log);
	}
}

/** The child and the one way to stop it. */
interface BackgroundProcess {
	child: Subprocess;
	stop: () => void;
}

/**
 * Sends SIGTERM once: a review treats a second signal as "exit now" and would skip its cleanup. It signals only while
 * this process has not seen the child exit; until then the child is not reaped, so its id cannot belong to another.
 */
function stopperFor(child: Subprocess): () => void {
	let isSent = false;

	return () => {
		if (isSent || child.exitCode !== null || child.signalCode !== null) return;

		isSent = true;
		child.kill('SIGTERM');
	};
}

/** Waits until the child records itself as the run's process, exits, runs out of time, or this process is stopped. */
async function awaitHandover(
	journal: RunJournal,
	background: BackgroundProcess,
	request: DetachRequest
): Promise<DetachOutcome> {
	const { child } = background;
	const deadline = Date.now() + request.handoverTimeoutMs;

	const stopped = new Promise<null>((resolve) =>
		request.signal.addEventListener('abort', () => resolve(null), { once: true })
	);

	for (;;) {
		if (request.signal.aborted) return endUnstarted(journal, background, cancelledBeforeStart());

		if (await hasTakenOver(journal, child)) return 'started';

		if (Date.now() >= deadline) {
			return endUnstarted(journal, background, notStartedInTime(request.handoverTimeoutMs));
		}

		const exitCode = await Promise.race([child.exited, delay(HANDOVER_POLL_MS, null), stopped]);

		if (exitCode !== null) return recordEarlyExit(journal, child, exitCode);
	}
}

async function hasTakenOver(journal: RunJournal, child: Subprocess): Promise<boolean> {
	const record = await readRunRecord(journal.runId, runFiles(journal.runId));

	return record?.pid === child.pid;
}

/**
 * Stops the child and waits for it to exit before deciding who records the end, so it cannot take the run over
 * afterwards. A child that took the run over before the stop had its signal handling in place, so it stops its review
 * and records the end itself; otherwise this process records `ending`.
 */
async function endUnstarted(
	journal: RunJournal,
	background: BackgroundProcess,
	ending: CliError
): Promise<DetachOutcome> {
	const { child, stop } = background;

	stop();
	await child.exited;

	if (!(await hasTakenOver(journal, child))) await journal.finish(endOfFailure(ending));

	return ending.exitCode === EXIT.cancelled ? 'cancelled' : 'not-started';
}

/** A child that exits before taking the run over leaves the run to this process to close. */
async function recordEarlyExit(journal: RunJournal, child: Subprocess, exitCode: number): Promise<DetachOutcome> {
	if (await hasTakenOver(journal, child)) return 'started';

	const message = `the background review exited with code ${exitCode} before it started`;

	await journal.finish(endOfFailure(new CliError(message, EXIT.failed)));

	return 'not-started';
}

function cancelledBeforeStart(): CliError {
	return new CliError('the review was cancelled before it started', EXIT.cancelled);
}

function notStartedInTime(timeoutMs: number): CliError {
	return new CliError(`the background review did not start within ${timeoutMs} ms`, EXIT.failed);
}
