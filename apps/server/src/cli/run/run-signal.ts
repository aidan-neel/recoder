/** The signal a review runs under and the reason it stopped, once it has. */
export interface RunSignal {
	signal: AbortSignal;
	/** Why the signal aborted: the caller cancelled, or `--timeout` ran out; null while it has not. */
	stopReason(): string | null;
}

/**
 * One signal that aborts when the caller's does or after `timeoutMs`; a null timeout leaves it to the pipeline's own
 * deadline. It is opened before the target is resolved, so the timeout covers a slow checkout too.
 */
export function openRunSignal(caller: AbortSignal, timeoutMs: number | null): RunSignal {
	const timeout = timeoutMs === null ? null : AbortSignal.timeout(timeoutMs);

	return {
		signal: timeout ? AbortSignal.any([caller, timeout]) : caller,
		stopReason: () => {
			if (caller.aborted) return 'The review was cancelled.';

			return timeout?.aborted ? `The review stopped after the ${timeoutMs} ms timeout.` : null;
		}
	};
}
