/** Exit codes a calling agent can branch on. Nonzero other than `findings` means the tool itself did not finish. */
export const EXIT = {
	ok: 0,
	/** The review finished and a finding met `--fail-on`. */
	findings: 1,
	/** A flag or argument was wrong. */
	usage: 2,
	/** The review started and did not finish. */
	failed: 3,
	/** The machine is not ready: no model, no git, an unreadable repository. */
	notReady: 4,
	cancelled: 130
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** An error the command line reports in one line and exits on; the message is for the calling agent. */
export class CliError extends Error {
	constructor(
		message: string,
		readonly exitCode: ExitCode
	) {
		super(message);
		this.name = 'CliError';
	}
}

/** A wrong flag or argument. */
export function usageError(message: string): CliError {
	return new CliError(message, EXIT.usage);
}

/** A missing prerequisite the caller has to fix before a review can run. */
export function notReadyError(message: string): CliError {
	return new CliError(message, EXIT.notReady);
}

/** The reason something failed, in one line, with no stack. */
export function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The code of a system error, such as `ENOENT` or `ESRCH`; null for anything else. */
export function errorCode(error: unknown): string | null {
	return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : null;
}

/** A module that cannot load, usually because the environment is wrong, means this machine is not ready. */
export async function loadOrNotReady<Loaded>(load: () => Promise<Loaded>): Promise<Loaded> {
	try {
		return await load();
	} catch (error) {
		throw notReadyError(`cannot start: ${describeError(error)}. Run recoder doctor to see what is missing.`);
	}
}
