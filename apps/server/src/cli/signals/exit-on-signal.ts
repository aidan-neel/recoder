import { constants } from 'node:os';
import { shutdownSignals } from './shutdown-signals.js';

const SHELL_SIGNAL_BASE = 128;

/** The exit code a shell reports for a process that `name` ended: 128 plus the signal's number. */
export function signalExitCode(name: NodeJS.Signals): number {
	return SHELL_SIGNAL_BASE + constants.signals[name];
}

/** From now on, a stop ends the process at once with the signal's usual code (130, 143 or 129). */
export function exitOnSignal(): void {
	for (const name of shutdownSignals()) process.on(name, () => process.exit(signalExitCode(name)));
}

/**
 * Runs `write` so that a stop can neither cut it short nor be lost: a stop that arrives during the write is held and
 * ends the process once the write is done, and every later stop ends it at once. For the record of a run's end, which
 * a watcher can see before this process has returned from writing it.
 */
export async function exitOnSignalAfter(write: () => Promise<void>): Promise<void> {
	let held: NodeJS.Signals | null = null;
	let isWritten = false;

	for (const name of shutdownSignals()) {
		process.on(name, () => {
			if (isWritten) process.exit(signalExitCode(name));

			held ??= name;
		});
	}

	await write();
	isWritten = true;

	if (held) process.exit(signalExitCode(held));
}
