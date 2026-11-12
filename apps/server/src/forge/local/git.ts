import { GhError } from '../cli.js';
import { processOutput, type ProcessOutput } from '../../util/process.js';

/** A local git command that exited non-zero; `code` lets callers read exit 1 as an answer (missing ref, not an ancestor). */
export class LocalGitError extends GhError {
	readonly code: number;

	constructor(code: number, cwd: string, args: string[], stderr: string) {
		super('unknown', `git ${args[0]} failed in ${cwd}: ${stderr.trim().slice(-500)}`);
		this.code = code;
	}
}

/**
 * Runs git in the local repo directly rather than through the command runner,
 * which allowlists commands, records runs and truncates logs: these are reads
 * whose full output is the answer. A repo path that is gone is an unknown GhError.
 */
async function spawnGit(cwd: string, args: string[], signal?: AbortSignal): Promise<ProcessOutput> {
	let proc;

	try {
		proc = Bun.spawn(['git', '-c', 'core.quotePath=false', ...args], {
			cwd,
			env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
			stdout: 'pipe',
			stderr: 'pipe',
			signal
		});
	} catch (err) {
		throw new GhError('unknown', `Cannot run git in ${cwd}: ${err instanceof Error ? err.message : String(err)}`);
	}

	return processOutput(proc);
}

/** Stdout of a git command in `cwd`, as printed; a failure is a LocalGitError carrying git's exit code and message. */
export async function localGitOutput(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
	const { stdout, stderr, code } = await spawnGit(cwd, args, signal);

	if (code !== 0) throw new LocalGitError(code, cwd, args, stderr);

	return stdout;
}

/** Trimmed stdout of a git command in `cwd`. */
export async function localGit(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
	return (await localGitOutput(cwd, args, signal)).trim();
}
