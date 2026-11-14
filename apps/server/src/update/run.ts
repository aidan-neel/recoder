import { childEnv } from '../util/process';

/** What a finished subprocess left behind. */
export interface RunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

interface RunOptions {
	cwd?: string;
	/** Merged over the process environment for this run only (a test's PATH, say). */
	env?: Record<string, string>;
	timeoutMs?: number;
}

/** Runs argv[0] with the rest as arguments — never a shell. Injected so a test owns what `git` and `bun` do. */
export type RunProcess = (argv: string[], options?: RunOptions) => Promise<RunResult>;

/** A command that ended nonzero; the message carries its stderr, not secrets. */
class CommandFailedError extends Error {
	readonly exitCode: number;

	constructor(
		readonly argv: string[],
		result: RunResult
	) {
		super(`\`${argv.join(' ')}\` failed (${result.exitCode}): ${result.stderr.trim() || 'no output'}`);
		this.name = 'CommandFailedError';
		this.exitCode = result.exitCode;
	}
}

/** How long a subprocess may run before it is killed. */
const COMMAND_TIMEOUT_MS = 120_000;

/** The production runner: spawn, capture both streams, kill on timeout. */
export const spawnProcess: RunProcess = async (argv, options = {}) => {
	const proc = Bun.spawn(argv, {
		cwd: options.cwd,
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'pipe',
		env: childEnv(options.env),
		timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	]);

	return { exitCode, stdout, stderr };
};

/** The result, or a CommandFailedError carrying stderr when the command lost. */
export function requireSuccess(argv: string[], result: RunResult): RunResult {
	if (result.exitCode !== 0) throw new CommandFailedError(argv, result);

	return result;
}
