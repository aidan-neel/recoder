const STDOUT_METHODS = ['log', 'info', 'debug'] as const;

/**
 * The calling agent reads the report from standard output, so one stray line from the pipeline would corrupt it.
 * For the length of a run these console methods write to standard error instead; the returned function puts them back.
 */
export function redirectConsoleToStderr(): () => void {
	const originals = STDOUT_METHODS.map((method) => ({ method, write: console[method] }));

	for (const method of STDOUT_METHODS) console[method] = (...args: unknown[]) => console.error(...args);

	return () => {
		for (const { method, write } of originals) console[method] = write;
	};
}
