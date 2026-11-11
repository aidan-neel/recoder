import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT } from '../../src/cli/exit';
import { signalExitCode } from '../../src/cli/signals/exit-on-signal';
import { lineReader } from './line-reader';
import { hookEnv, programEnv, startProgram } from './program-launch';
import { goneIdentity, useFreshDataDir } from './runs/run-fixtures';

useFreshDataDir();

let folder = '';

beforeEach(() => {
	folder = realpathSync(mkdtempSync(join(tmpdir(), 'recoder-repository-env-')));
});

afterEach(() => rmSync(folder, { recursive: true, force: true }));

/** A new empty git repository named `name` in this test's folder. */
function createRepository(name: string): string {
	const path = join(folder, name);

	mkdirSync(path);
	Bun.spawnSync(['git', 'init', '--quiet', path], { env: programEnv() });

	return path;
}

/** Starts the program fixture as a git hook would, with the hook's variables pointed at a decoy repository. */
function startUnderHook(mode: string, options: { args?: string[]; detached?: boolean } = {}) {
	return startProgram(mode, hookEnv(createRepository('decoy')), options);
}

function processGroupOf(pid: number): string {
	return Bun.spawnSync(['ps', '-o', 'pgid=', '-p', String(pid)], { env: programEnv() })
		.stdout.toString()
		.trim();
}

test('under a git hook, a child started without an env sees no repository variable and git finds its own repository', async () => {
	const app = createRepository('app');
	const program = startUnderHook('env', { args: [app] });

	const output = await new Response(program.stdout).text();

	expect(output.split('\n')).toEqual(['unset unset unset', join(app, '.git'), '']);
	expect(await program.exited).toBe(EXIT.ok);
});

test('the program run again without the variables exits with the code its command returned', async () => {
	expect(await startUnderHook('exit').exited).toBe(EXIT.notReady);
});

test('a run ended by a signal makes the program exit with 128 plus the signal number', async () => {
	expect(await startUnderHook('killed').exited).toBe(signalExitCode('SIGKILL'));
});

test('a stop sent to the program alone reaches the review once, so it ends as cancelled after its cleanup', async () => {
	const program = startUnderHook('wait-for-stop');
	const nextLine = lineReader(program.stdout);

	expect(await nextLine()).toStartWith('ready ');

	program.kill('SIGTERM');

	expect(await nextLine()).toBe('aborted');
	expect(await program.exited).toBe(EXIT.cancelled);
});

test('a stop sent to the whole process group reaches the review once, since it runs outside that group', async () => {
	const program = startUnderHook('wait-for-stop', { detached: true });
	const nextLine = lineReader(program.stdout);
	const reviewPid = Number((await nextLine()).replace('ready ', ''));

	expect(processGroupOf(reviewPid)).not.toBe(processGroupOf(program.pid));

	process.kill(-program.pid, 'SIGTERM');

	expect(await nextLine()).toBe('aborted');
	expect(await program.exited).toBe(EXIT.cancelled);
});

test('a SIGKILL of the program under a git hook makes the copy cancel its review, clean up and end', async () => {
	const program = startUnderHook('wait-for-stop');
	const nextLine = lineReader(program.stdout);

	expect(await nextLine()).toStartWith('ready ');

	program.kill('SIGKILL');

	expect(await nextLine()).toBe('aborted');
	await expect(nextLine()).rejects.toThrow();
});

test('the copy keeps the outer process id out of the environment it gives the --detach background process', async () => {
	const output = await new Response(startUnderHook('outer-marker').stdout).text();

	expect(output).toBe('unset\n');
});

/** Starts the program as a copy whose marker names `outerPid`, which is not its parent, and returns its exit code. */
function startCopyMarking(outerPid: number): Promise<number> {
	return startProgram('exit', { ...programEnv(), RECODER_OUTER_PID: String(outerPid) }).exited;
}

test('a copy whose outer process died before it started stops as on SIGTERM instead of running on', async () => {
	const { pid } = await goneIdentity();

	expect(await startCopyMarking(pid)).toBe(signalExitCode('SIGTERM'));
});

test('a recoder an agent starts with the marker of a living outer process runs its command and follows no one', async () => {
	const livingOuter = Bun.spawn(['sleep', '60'], { env: programEnv(), stdio: ['ignore', 'ignore', 'ignore'] });

	try {
		expect(await startCopyMarking(livingOuter.pid)).toBe(EXIT.notReady);
	} finally {
		livingOuter.kill();
		await livingOuter.exited;
	}
});
