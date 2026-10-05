import { GhError } from '../cli.js';
import { processOutput, type ProcessOutput } from '../../util/process.js';

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

/** Stdout of a git command in `cwd`, as printed; a failure is an unknown GhError carrying git's message. */
export async function localGitOutput(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
	const { stdout, stderr, code } = await spawnGit(cwd, args, signal);

	if (code !== 0) throw new GhError('unknown', `git ${args[0]} failed in ${cwd}: ${stderr.trim().slice(-500)}`);

	return stdout;
}

/** Trimmed stdout of a git command in `cwd`. */
export async function localGit(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
	return (await localGitOutput(cwd, args, signal)).trim();
}

/** Whether a git command exits 0, for yes/no questions like `merge-base --is-ancestor`. */
export async function localGitSucceeds(cwd: string, args: string[], signal?: AbortSignal): Promise<boolean> {
	return (await spawnGit(cwd, args, signal)).code === 0;
}
