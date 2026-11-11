import { afterEach, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseReviewArgs } from '../../../src/cli/args/review-args';
import { parseRunId } from '../../../src/cli/runs/run-id';
import { readRunStatus } from '../../../src/cli/runs/run-status';
import { useFreshDataDir } from '../runs/run-fixtures';
import { childEnvironment, testDataDir } from '../child-env';
import { connect, TestProcesses, testEnvironment, toolCall, toolResultOf, writeTestPatch } from './server-harness';

const BACKGROUND_FIXTURE = new URL('../runs/background-fixture.ts', import.meta.url).pathname;

/** Longer than the background fixture needs to start and take its run over. */
const TEST_TIMEOUT_MS = 40_000;

const processes = new TestProcesses();

afterEach(() => processes.reset());

useFreshDataDir();

/** Starts a review on a server whose background reviews run `command`, and returns the call's result. */
async function startReview(command: string[], args: object) {
	const server = await connect(testEnvironment(command, processes));

	server.send(toolCall(1, 'recoder_review', args));

	const result = toolResultOf(await server.replyTo(1));

	return { server, result };
}

test('review arguments reach the background review as the equivalent flags', async () => {
	const { server } = await startReview(['true'], {
		title: 'Add retry',
		include: ['src/**', 'lib/**'],
		lens: ['correctness,security'],
		'no-exec': true,
		'keep-checkout': false,
		budget: 'medium'
	});

	server.close();
	await server.served;

	const [, ...flags] = processes.spawned[0].argv;
	const { options, launch } = parseReviewArgs(flags, tmpdir(), 'program');

	expect(launch.kind).toBe('background');

	expect(options).toMatchObject({
		intent: { title: 'Add retry' },
		scope: { include: ['src/**', 'lib/**'] },
		tuning: { lenses: ['correctness', 'security'], exec: false, budget: 'medium' },
		keepCheckout: false
	});
});

test('a flag recoder_review leaves out is refused and starts nothing', async () => {
	const { server, result } = await startReview(['true'], { uncommitted: true, format: 'markdown' });

	server.close();
	await server.served;

	expect(result.isError).toBe(true);
	expect(processes.spawned).toEqual([]);
});

test('a diff from standard input is refused and starts nothing', async () => {
	const { server, result } = await startReview(['true'], { diff: '-' });

	server.close();
	await server.served;

	expect(result.isError).toBe(true);
	expect(processes.spawned).toEqual([]);
});

test('a review that fails before the handover is a tool error carrying the status', async () => {
	const { server, result } = await startReview(['true'], { uncommitted: true });

	server.close();
	await server.served;

	expect(result.isError).toBe(true);

	expect(JSON.parse(result.text)).toMatchObject({
		state: 'failed',
		error: expect.stringContaining('before it started')
	});
});

test('a failed start returns its status as it is, even where a path reads like a command', async () => {
	const repoPath = join(tmpdir(), 'recoder review');
	const { server, result } = await startReview(['true'], { uncommitted: true, repo: repoPath });

	server.close();
	await server.served;

	expect(result.isError).toBe(true);
	expect(JSON.parse(result.text)).toMatchObject({ state: 'failed', repoPath });
});

test('an error that holds a path reading like a command keeps the path', async () => {
	const diff = join(tmpdir(), 'recoder runs', 'missing.patch');
	const { server, result } = await startReview(['true'], { diff });

	server.close();
	await server.served;

	expect(result.isError).toBe(true);
	expect(result.text).toContain(`diff names ${diff}, which does not exist.`);
});

test(
	'closing the input ends the server and leaves a started review running',
	async () => {
		const { server, result } = await startReview([process.execPath, BACKGROUND_FIXTURE], { diff: writeTestPatch() });
		const { runId } = JSON.parse(result.text);

		expect(result.isError).toBe(false);

		server.close();
		await server.served;

		expect((await readRunStatus(parseRunId(runId))).state).toBe('running');
		expect(processes.spawned[0].child.killed).toBe(false);
	},
	TEST_TIMEOUT_MS
);

test('a body-file that is a pipe is refused at once, and the server answers the next request', async () => {
	const fifo = makeFifo();
	const writer = Bun.spawn(['sh', '-c', 'printf body > "$1"', 'sh', fifo], { env: childEnvironment(testDataDir()) });

	try {
		const { server, result } = await startReview(['true'], { diff: writeTestPatch(), 'body-file': fifo });

		server.send({ jsonrpc: '2.0', id: 2, method: 'ping' });

		expect((await server.replyTo(2)).result).toEqual({});
		expect(result.isError).toBe(true);
		expect(result.text).toStartWith('body-file must name a regular file');
		expect(processes.spawned).toEqual([]);

		server.close();
		await server.served;
	} finally {
		writer.kill('SIGKILL');
		await writer.exited;
	}
});

test('a diff that is not a regular file is refused and starts nothing', async () => {
	const { server, result } = await startReview(['true'], { diff: makeFifo() });

	server.close();
	await server.served;

	expect(result.isError).toBe(true);
	expect(result.text).toStartWith('diff must name a regular file');
	expect(processes.spawned).toEqual([]);
});

/** A named pipe in the test's data folder: reading it blocks until something writes to it. */
function makeFifo(): string {
	const path = join(testDataDir(), 'pipe');
	const made = Bun.spawnSync(['mkfifo', path], { env: childEnvironment(testDataDir()) });

	if (made.exitCode !== 0) throw new Error(`mkfifo failed with code ${made.exitCode}`);

	return path;
}
