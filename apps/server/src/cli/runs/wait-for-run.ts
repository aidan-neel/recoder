import type { RunId } from './run-id.js';
import { readRunStatus, type RunStatus } from './run-status.js';

/** How often `recoder wait` reads the run again. Each read of a running run starts one `ps`. */
const WAIT_POLL_MS = 2_000;

/** Time as `waitForRun` sees it; injected so tests need no real clock. */
export interface WaitClock {
	now: () => number;
	/** Resolves after `ms`, or at once when `signal` aborts. */
	sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** What to wait for. */
export interface WaitRequest {
	runId: RunId;
	/** Null waits until the run ends. */
	timeoutMs: number | null;
	/** Ends the wait early; the run itself is left alone. */
	signal: AbortSignal;
	clock: WaitClock;
}

/** The real clock. */
export const SYSTEM_CLOCK: WaitClock = { now: () => Date.now(), sleep: sleepUnlessAborted };

/** Reads the run until it has ended, the timeout has passed or the signal aborts, and returns its last status. */
export async function waitForRun(request: WaitRequest): Promise<RunStatus> {
	const { runId, signal, clock } = request;
	const deadline = request.timeoutMs === null ? Infinity : clock.now() + request.timeoutMs;

	for (;;) {
		const status = await readRunStatus(runId);

		if (status.state !== 'running' || signal.aborted || clock.now() >= deadline) return status;

		await clock.sleep(Math.min(WAIT_POLL_MS, deadline - clock.now()), signal);
	}
}

function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const finish = (): void => {
			clearTimeout(timer);
			signal.removeEventListener('abort', finish);
			resolve();
		};

		const timer = setTimeout(finish, ms);

		signal.addEventListener('abort', finish, { once: true });
	});
}
