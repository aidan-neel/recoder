import type { ExitCode } from './exit.js';
import { hasRepositoryEnv, runWithoutRepositoryEnv, stopWithOuterProcess } from './repository-env.js';
import { exitOnSignal } from './signals/exit-on-signal.js';

/** Runs a command line and returns its exit code; every failure is already reported. */
export type CommandRunner = (argv: string[]) => Promise<ExitCode>;

/**
 * The program's start and end, around `runCommand`. Under a git hook's repository variables the program runs again
 * without them, so no command it starts, directly or through the pipeline, acts on the wrong repository.
 */
export async function runProgram(argv: string[], runCommand: CommandRunner): Promise<never> {
	const exitCode = hasRepositoryEnv() ? await runWithoutRepositoryEnv(argv) : await runHere(argv, runCommand);

	return endProcess(exitCode);
}

/** Runs the command in this process, which may be the copy a git hook's run started. */
function runHere(argv: string[], runCommand: CommandRunner): Promise<ExitCode> {
	stopWithOuterProcess();

	return runCommand(argv);
}

/**
 * Ends the process once its output is out. A review leaves agent children (`opencode serve`, the MCP tool host) that
 * keep the event loop alive and that only the `exit` hooks stop, so the process would never end by itself. Both
 * standard streams are ended first, which waits for text a slow reader has not taken yet: `process.exit` would drop
 * it. Until the exit, a stop ends the process at once, since nothing is left to cancel.
 */
async function endProcess(exitCode: number): Promise<never> {
	exitOnSignal();

	await Promise.all([finishStream(process.stdout), finishStream(process.stderr)]);

	process.exit(exitCode);
}

/**
 * Resolves once everything written to `stream` is out. A reader that has gone away fails the end with EPIPE; the exit
 * code is already decided and there is nowhere left to say so, so that ends the wait too.
 */
function finishStream(stream: NodeJS.WriteStream): Promise<void> {
	return new Promise((resolve) => {
		stream.on('error', () => resolve());
		stream.end(() => resolve());
	});
}
