import type { Subprocess } from 'bun';
import { EXIT, describeError } from './exit.js';
import { writeStderrLine } from './output/streams.js';
import { isProcessPresent } from './runs/process-identity.js';
import { selfCommand } from './self-command.js';
import { signalExitCode } from './signals/exit-on-signal.js';
import { shutdownSignals } from './signals/shutdown-signals.js';
import { REPOSITORY_ENV, environmentWithoutRepository } from './target/git.js';

/** Names, in the copy's environment, the process that started the copy. */
const OUTER_PID_ENV = 'RECODER_OUTER_PID';

/** How often the copy checks that the process that started it is still its parent. */
const OUTER_CHECK_MS = 500;

const DECIMAL = /^[1-9]\d*$/;

/** Whether a variable that points git at another repository is set, as it is when a git hook runs this program. */
export function hasRepositoryEnv(): boolean {
	return REPOSITORY_ENV.some((name) => process.env[name] !== undefined);
}

/**
 * Runs this same program again with the same arguments and standard streams, without the repository variables, and
 * returns its exit code (128 plus the signal's number when a signal ended it). Deleting them from `process.env` would
 * not do: a child that Bun starts without an explicit `env`, as the pipeline's, sandbox's and agents' commands are,
 * gets the environment this process started with.
 *
 * The copy runs in its own session (`setsid`) because a shared process group would deliver a terminal's Ctrl-C to it
 * twice, once directly and once passed on by this process, and a review treats a second stop as "exit now" and skips
 * its cleanup; the cost is that the copy has no controlling terminal, so it cannot prompt on `/dev/tty` and is outside
 * the shell's job control. A SIGKILL of this process cannot be passed on, so the copy watches for it instead
 * (`stopWithOuterProcess`).
 */
export async function runWithoutRepositoryEnv(argv: string[]): Promise<number> {
	const child = startCleanCopy(argv);

	if (child === null) return EXIT.failed;

	forwardSignals(child);

	const exitCode = await child.exited;

	return child.signalCode === null ? exitCode : signalExitCode(child.signalCode);
}

/**
 * In the copy `runWithoutRepositoryEnv` started, stops this process as SIGTERM does once the process that started it is
 * gone, so a SIGKILL of that process still cancels the review and runs its cleanup. The marker leaves `process.env` at
 * once, so the `--detach` background process, which gets `process.env` and must outlive its launcher, never sees it.
 *
 * A marker that names another process than the parent means one of two things. The outer process died before this
 * copy started, so the copy was handed to another parent: the marked process is gone, and the copy stops at once. Or
 * this is a `recoder` an agent started without an `env`, which still has the marker its review started with: the
 * marked process is alive, and this one follows no one.
 */
export function stopWithOuterProcess(): void {
	const outerPid = outerPidOf(process.env);

	delete process.env[OUTER_PID_ENV];

	if (outerPid === null) return;

	if (outerPid === process.ppid) followOuterProcess(outerPid);
	else if (!isProcessPresent(outerPid)) stopAsOnSigterm();
}

function outerPidOf(environment: NodeJS.ProcessEnv): number | null {
	const marker = environment[OUTER_PID_ENV];

	return marker !== undefined && DECIMAL.test(marker) ? Number(marker) : null;
}

/** Stops this process once it is no longer the child of `outerPid`, checking without keeping the process alive. */
function followOuterProcess(outerPid: number): void {
	const check = setInterval(() => {
		if (process.ppid === outerPid) return;

		clearInterval(check);
		stopAsOnSigterm();
	}, OUTER_CHECK_MS);

	check.unref();
}

/** The stop a caller's SIGTERM would be, so the command's own handling of it runs. */
function stopAsOnSigterm(): void {
	process.kill(process.pid, 'SIGTERM');
}

function startCleanCopy(argv: string[]): Subprocess | null {
	try {
		return Bun.spawn([...selfCommand(Bun.main), ...argv], {
			stdio: ['inherit', 'inherit', 'inherit'],
			env: { ...environmentWithoutRepository(), [OUTER_PID_ENV]: String(process.pid) },
			detached: true
		});
	} catch (error) {
		writeStderrLine(`recoder: cannot start without the git repository variables: ${describeError(error)}`);

		return null;
	}
}

/**
 * Passes each stop on once, and only while this process has not seen the copy exit: until then the copy is not
 * reaped, so its id cannot belong to another process. A hang-up this process started ignoring is not passed on.
 */
function forwardSignals(child: Subprocess): void {
	for (const name of shutdownSignals()) {
		process.on(name, () => {
			if (child.exitCode === null && child.signalCode === null) child.kill(name);
		});
	}
}
