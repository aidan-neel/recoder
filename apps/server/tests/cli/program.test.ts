import { expect, test } from 'bun:test';
import type { Subprocess } from 'bun';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { EXIT } from '../../src/cli/exit';
import { signalExitCode } from '../../src/cli/signals/exit-on-signal';
import { lineReader } from './line-reader';
import { IGNORING_HANG_UP, PROGRAM_FIXTURE, hookEnv, programEnv, startProgram, withPipe } from './program-launch';
import { useFreshDataDir } from './runs/run-fixtures';

useFreshDataDir();

/**
 * Runs a command that leaves an agent-like child running and returns what the program printed, read to its end: the
 * child holds standard output, so the end comes only once the program has exited and the child is gone.
 */
async function runHoldingChild(env: Record<string, string>) {
	const program = startProgram('hold-child', env);
	const output = await new Response(program.stdout).text();

	return { output, exitCode: await program.exited };
}

test('a command that leaves an agent child running still ends the process with its code, and stops the child', async () => {
	expect(await runHoldingChild(programEnv())).toEqual({ output: 'done\n', exitCode: EXIT.notReady });
});

test('run again under a git hook, the program ends when its run does, and the child is stopped', async () => {
	expect(await runHoldingChild(hookEnv(tmpdir()))).toEqual({ output: 'done\n', exitCode: EXIT.notReady });
});

/**
 * Hangs up on a review that runs on an agent-like child, as a closing terminal does, and returns its exit code once
 * its output has ended, which needs the child gone too.
 */
async function hangUpOnAgentReview(env: Record<string, string>): Promise<number> {
	const program = startProgram('agent-until-stop', env);
	const nextLine = lineReader(program.stdout);

	await nextLine();
	program.kill('SIGHUP');

	expect(await nextLine()).toBe('aborted');
	await expect(nextLine()).rejects.toThrow();

	return program.exited;
}

test('a hang-up cancels a review, stops its agent child and ends the process as cancelled', async () => {
	expect(await hangUpOnAgentReview(programEnv())).toBe(EXIT.cancelled);
});

test('a hang-up passed on to the copy under a git hook stops its agent child too', async () => {
	expect(await hangUpOnAgentReview(hookEnv(tmpdir()))).toBe(EXIT.cancelled);
});

/** Whether the process ignores SIGHUP, as Linux shows it: the lowest bit of its `SigIgn` mask. */
function ignoresHangUp(pid: number): boolean {
	const mask = /^SigIgn:\s*([0-9a-f]+)$/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? '0';

	return (Number.parseInt(mask.slice(-1), 16) & 1) === 1;
}

/**
 * Only Linux shows which signals a process ignores, and only there can the program read it of itself: on macOS it
 * handles SIGHUP as before, so there is nothing to check. Bun handles two signals sent at once in an order of its own
 * (a SIGTERM before an earlier SIGHUP, measured), so these tests read the mask instead of racing a hang-up and a stop.
 */
const onLinux = test.skipIf(process.platform !== 'linux');

/**
 * Starts a review with SIGHUP ignored, as `nohup` does, and returns whether the started process still ignores it once
 * ready, and its exit code after a stop.
 */
async function reviewIgnoringHangUps(env: Record<string, string>) {
	const program = startProgram('wait-for-stop', env, { prefix: IGNORING_HANG_UP });
	const nextLine = lineReader(program.stdout);

	expect(await nextLine()).toStartWith('ready ');

	const isIgnored = ignoresHangUp(program.pid);

	program.kill('SIGTERM');

	return { isIgnored, exitCode: await program.exited };
}

onLinux('a review started with hang-ups ignored leaves them ignored, and a stop still cancels it', async () => {
	expect(await reviewIgnoringHangUps(programEnv())).toEqual({ isIgnored: true, exitCode: EXIT.cancelled });
});

onLinux('under a git hook, a program started with hang-ups ignored does not catch one to pass on', async () => {
	expect(await reviewIgnoringHangUps(hookEnv(tmpdir()))).toEqual({ isIgnored: true, exitCode: EXIT.cancelled });
});

/** Starts a finished command whose last standard error nobody reads, and returns it once it is ending. */
function whileEnding<T>(prefix: string[], act: (program: Subprocess) => Promise<T>): Promise<T> {
	return withPipe(async ({ writer }) => {
		const ending = Promise.withResolvers<void>();

		const program = Bun.spawn([...prefix, 'bun', PROGRAM_FIXTURE, 'stop-while-ending'], {
			env: programEnv(),
			stdio: ['ignore', 'ignore', writer],
			ipc: () => ending.resolve()
		});

		await ending.promise;

		return act(program);
	});
}

test('one stop ends a process whose command has finished while its last output waits for a reader', async () => {
	const exitCode = await whileEnding([], (program) => {
		program.kill('SIGTERM');

		return program.exited;
	});

	expect(exitCode).toBe(signalExitCode('SIGTERM'));
});

onLinux('a process that started ignoring hang-ups still ignores them while it ends', async () => {
	const isIgnored = await whileEnding(IGNORING_HANG_UP, async (program) => {
		const ignored = ignoresHangUp(program.pid);

		program.kill('SIGTERM');
		await program.exited;

		return ignored;
	});

	expect(isIgnored).toBe(true);
});
