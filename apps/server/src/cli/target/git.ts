import { CliError, EXIT, notReadyError } from '../exit.js';
import { processOutput } from '../../util/process.js';

/**
 * Variables that point git at a repository, index or object store other than
 * the one in `cwd` (`git rev-parse --local-env-vars`). A git hook exports them,
 * so a review started from a hook would otherwise run every command, including
 * the throwaway checkout's, against the user's repository.
 */
export const REPOSITORY_ENV = [
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
	'GIT_CONFIG',
	'GIT_CONFIG_PARAMETERS',
	'GIT_CONFIG_COUNT',
	'GIT_OBJECT_DIRECTORY',
	'GIT_DIR',
	'GIT_WORK_TREE',
	'GIT_IMPLICIT_WORK_TREE',
	'GIT_GRAFT_FILE',
	'GIT_INDEX_FILE',
	'GIT_NO_REPLACE_OBJECTS',
	'GIT_REPLACE_REF_BASE',
	'GIT_PREFIX',
	'GIT_INTERNAL_SUPER_PREFIX',
	'GIT_SHALLOW_FILE',
	'GIT_COMMON_DIR'
];

/** This process's environment without the repository variables. */
export function environmentWithoutRepository(): Record<string, string> {
	const environment: Record<string, string> = {};

	for (const [name, value] of Object.entries(process.env)) {
		if (value !== undefined && !REPOSITORY_ENV.includes(name)) environment[name] = value;
	}

	return environment;
}

/**
 * Never prompt, never refresh an index as a side effect of reading, and never
 * download large files while checking out.
 */
const QUIET_ENV: Record<string, string> = {
	GIT_TERMINAL_PROMPT: '0',
	GIT_OPTIONAL_LOCKS: '0',
	GIT_LFS_SKIP_SMUDGE: '1'
};

/** The exit code git uses for "not found" in `--verify --quiet` style probes. */
const NOT_FOUND = 1;

const MAX_ERROR_CHARS = 600;

/** How one git command runs: where, with what extra environment, and what stops it. */
export interface GitCall {
	cwd: string;
	signal: AbortSignal;
	env?: Record<string, string>;
}

/** Runs git and returns its trimmed standard output; throws a `CliError` that quotes git's error when it fails. */
export async function gitOutput(call: GitCall, args: string[]): Promise<string> {
	const run = await spawnGit(call, args);

	if (run.code !== 0) throw gitFailure(call, args, run.stderr);

	return run.stdout.trim();
}

/** Like `gitOutput`, but null when git answers "not found" (exit 1), as `rev-parse --verify --quiet` does. */
export async function gitProbe(call: GitCall, args: string[]): Promise<string | null> {
	const run = await spawnGit(call, args);

	if (run.code === NOT_FOUND) return null;
	if (run.code !== 0) throw gitFailure(call, args, run.stderr);

	return run.stdout.trim();
}

/** Settings for one command as environment (`GIT_CONFIG_COUNT`), so argv keeps the subcommand first. */
export function gitConfigEnv(settings: Record<string, string>): Record<string, string> {
	const entries = Object.entries(settings);
	const environment: Record<string, string> = { GIT_CONFIG_COUNT: String(entries.length) };

	entries.forEach(([key, value], index) => {
		environment[`GIT_CONFIG_KEY_${index}`] = key;
		environment[`GIT_CONFIG_VALUE_${index}`] = value;
	});

	return environment;
}

/** Throws the cancellation error when `signal` has aborted. */
export function assertNotCancelled(signal: AbortSignal): void {
	if (signal.aborted) throw new CliError('Cancelled while preparing what to review.', EXIT.cancelled);
}

async function spawnGit(call: GitCall, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
	assertNotCancelled(call.signal);

	const run = await processOutput(startGit(call, args));

	assertNotCancelled(call.signal);

	return run;
}

/** Starts git; a missing binary or working directory is a machine that is not ready. */
function startGit(call: GitCall, args: string[]): Bun.Subprocess<'ignore', 'pipe', 'pipe'> {
	try {
		return Bun.spawn(['git', ...args], {
			cwd: call.cwd,
			env: gitEnvironment(call.env ?? {}),
			stdin: 'ignore',
			stdout: 'pipe',
			stderr: 'pipe',
			signal: call.signal
		});
	} catch (err) {
		throw notReadyError(`Could not run git in ${call.cwd}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

function gitEnvironment(extra: Record<string, string>): Record<string, string> {
	return { ...environmentWithoutRepository(), ...QUIET_ENV, ...extra };
}

function gitFailure(call: GitCall, args: string[], stderr: string): CliError {
	const reason = stderr.trim().slice(-MAX_ERROR_CHARS) || 'no error output';

	return notReadyError(`git ${args[0]} failed in ${call.cwd}: ${reason}`);
}
