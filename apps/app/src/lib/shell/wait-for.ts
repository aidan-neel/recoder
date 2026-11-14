/** Resolves after `ms`; an abort ends the wait at once with the signal's reason. */
export function waitFor(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason);

			return;
		}

		const timer = setTimeout(() => {
			signal.removeEventListener('abort', stop);
			resolve();
		}, ms);

		function stop(): void {
			clearTimeout(timer);
			reject(signal.reason);
		}

		signal.addEventListener('abort', stop, { once: true });
	});
}
