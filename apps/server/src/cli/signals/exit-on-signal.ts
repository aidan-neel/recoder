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
