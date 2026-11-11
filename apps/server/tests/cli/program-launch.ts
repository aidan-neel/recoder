import { closeSync, constants, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childEnvironment, testDataDir } from './child-env';

export const PROGRAM_FIXTURE = new URL('./program-fixture.ts', import.meta.url).pathname;

/** Runs a command with SIGHUP ignored, as `nohup` does, without nohup's redirect of a terminal's standard error. */
export const IGNORING_HANG_UP = ['sh', '-c', `trap '' HUP; exec "$@"`, 'sh'];

/** What the program starts with outside a git hook: the test's own data folder and nothing else. */
export function programEnv(): Record<string, string> {
	return childEnvironment(testDataDir());
}

/** The variables git exports to a hook, pointed at `repository`. */
export function hookEnv(repository: string): Record<string, string> {
	return {
		...programEnv(),
		GIT_DIR: join(repository, '.git'),
		GIT_WORK_TREE: repository,
		GIT_INDEX_FILE: join(repository, '.git', 'index')
	};
}

/** How to start the program fixture: its arguments, its own session, and a command it runs under. */
interface ProgramLaunch {
	args?: string[];
	detached?: boolean;
	prefix?: string[];
}

/** Starts the program fixture in `mode` with standard output piped to the test, standard error passed through. */
export function startProgram(mode: string, env: Record<string, string>, launch: ProgramLaunch = {}) {
	return Bun.spawn([...(launch.prefix ?? []), 'bun', PROGRAM_FIXTURE, mode, ...(launch.args ?? [])], {
		env,
		stdio: ['ignore', 'pipe', 'inherit'],
		detached: launch.detached ?? false
	});
}

/** The ends of a pipe the test holds: the write end to give a child, and a way to close the read end early. */
interface PipeEnds {
	writer: number;
	closeReader: () => void;
}

/**
 * A pipe whose reader is the test, which never reads it: a caller that has stopped reading leaves one so, and closing
 * the read end leaves one with no reader at all. Bun reads a child's `pipe` output as it comes, so a named pipe stands
 * in. POSIX opens a named pipe's read end at once when asked not to block, and then its write end at once since it
 * has a reader, so this works on Linux and macOS alike.
 */
export function withPipe<T>(use: (pipe: PipeEnds) => Promise<T>): Promise<T> {
	const folder = mkdtempSync(join(tmpdir(), 'recoder-pipe-'));
	const path = join(folder, 'pipe');
	const made = Bun.spawnSync(['mkfifo', path], { env: childEnvironment(folder) });

	if (made.exitCode !== 0) throw new Error(`mkfifo failed: ${made.stderr.toString().trim()}`);

	let reader: number | null = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
	const writer = openSync(path, constants.O_WRONLY);

	const closeReader = (): void => {
		if (reader === null) return;

		closeSync(reader);
		reader = null;
	};

	return use({ writer, closeReader }).finally(() => {
		closeReader();
		closeSync(writer);
		rmSync(folder, { recursive: true, force: true });
	});
}
