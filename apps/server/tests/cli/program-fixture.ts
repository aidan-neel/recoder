import { EXIT, type ExitCode } from '../../src/cli/exit';
import { writeStdout } from '../../src/cli/output/streams';
import { runProgram, type CommandRunner } from '../../src/cli/program';
import { abortOnSignal } from '../../src/cli/signals/abort-on-signal';

/** Ends the fixture if a test fails to, so it never outlives the suite. */
const LIFETIME_MS = 60_000;

/** More than a pipe holds, so ending standard error waits for a reader that never comes. */
const UNREAD_STDERR_CHARS = 256 * 1024;

/** What each mode does as its command; the program's real start and end run around it. */
const COMMANDS: Record<string, CommandRunner> = {
	env: printWhatChildrenSee,
	exit: async () => EXIT.notReady,
	killed: killSelf,
	'wait-for-stop': waitForStop,
	'hold-child': holdChildLikeAnAgent,
	'agent-until-stop': agentUntilStop,
	'stop-while-ending': stopWhileEnding,
	'outer-marker': printOuterMarker
};

setTimeout(() => process.exit(EXIT.failed), LIFETIME_MS).unref();

await runProgram(Bun.argv.slice(2), COMMANDS[Bun.argv[2]]);

/** Prints the git variables an env-less child sees, then the repository an env-less git resolves in `argv[1]`. */
async function printWhatChildrenSee(argv: string[]): Promise<ExitCode> {
	const shell = 'echo "${GIT_DIR-unset} ${GIT_WORK_TREE-unset} ${GIT_INDEX_FILE-unset}"';

	await Bun.spawn(['sh', '-c', shell], { stdio: ['ignore', 'inherit', 'inherit'] }).exited;

	await Bun.spawn(['git', 'rev-parse', '--absolute-git-dir'], { cwd: argv[1], stdio: ['ignore', 'inherit', 'inherit'] })
		.exited;

	return EXIT.ok;
}

/** Prints what a child given `process.env`, as the `--detach` background process is, would see of the outer pid. */
async function printOuterMarker(): Promise<ExitCode> {
	await writeStdout(`${process.env.RECODER_OUTER_PID ?? 'unset'}\n`);

	return EXIT.ok;
}

async function killSelf(): Promise<ExitCode> {
	process.kill(process.pid, 'SIGKILL');

	return EXIT.ok;
}

/** A review's signal handling: says it is ready, then ends as cancelled after the first stop. */
async function waitForStop(): Promise<ExitCode> {
	const signal = abortOnSignal();
	const keepAlive = setInterval(() => {}, LIFETIME_MS);
	const stopped = new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));

	await writeStdout(`ready ${process.pid}\n`);
	await stopped;
	await writeStdout('aborted\n');
	clearInterval(keepAlive);

	return EXIT.cancelled;
}

/** A command that leaves an agent-like child running when it returns. */
async function holdChildLikeAnAgent(): Promise<ExitCode> {
	startAgentLikeChild();

	await writeStdout('done\n');

	return EXIT.notReady;
}

/** A review on a live agent that runs until it is stopped. */
async function agentUntilStop(): Promise<ExitCode> {
	startAgentLikeChild();

	return waitForStop();
}

/**
 * What a live agent leaves behind: a long-running child that keeps the event loop alive, stopped only by an `exit`
 * hook, as `opencode.ts` stops `opencode serve`. The child holds standard output too, so the reader sees its end only
 * once the child is gone.
 */
function startAgentLikeChild(): void {
	const agent = Bun.spawn(['sleep', '60'], { stdio: ['ignore', 'inherit', 'ignore'] });

	process.once('exit', () => agent.kill());
}

/**
 * A finished review whose last standard error a reader does not take, so the process is still ending. It tells the
 * test once the command has returned, which is after the end began.
 */
async function stopWhileEnding(): Promise<ExitCode> {
	abortOnSignal();
	process.stderr.write('x'.repeat(UNREAD_STDERR_CHARS));
	setImmediate(() => process.send?.('ending'));

	return EXIT.ok;
}
