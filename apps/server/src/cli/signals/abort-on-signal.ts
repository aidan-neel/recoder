import { signalExitCode } from './exit-on-signal.js';
import { shutdownSignals } from './shutdown-signals.js';

/**
 * A signal that aborts on the first of `names`: by default SIGINT, SIGTERM and, unless the process started ignoring it,
 * SIGHUP. The listeners stay for the life of the process, so nothing else that registers one (the server's store, the
 * agent adapters) is the last listener and ends the process before the review has stopped and been written. A second
 * signal ends the process at once with the signal's usual code (130, 143 or 129); `process.exit` still runs the
 * `exit` hooks that stop agent children.
 */
export function abortOnSignal(names: readonly NodeJS.Signals[] = shutdownSignals()): AbortSignal {
	const controller = new AbortController();

	for (const name of names) {
		process.on(name, () => {
			if (controller.signal.aborted) process.exit(signalExitCode(name));

			controller.abort();
		});
	}

	return controller.signal;
}
