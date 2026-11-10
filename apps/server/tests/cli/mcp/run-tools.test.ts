import { afterEach, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFiles } from '../../../src/cli/runs/run-files';
import { parseRunId, type RunId } from '../../../src/cli/runs/run-id';
import { readRunStatus } from '../../../src/cli/runs/run-status';
import { saveReport } from '../../../src/cli/runs/stored-report';
import { report } from '../output/fixtures';
import { COMPLETE, liveIdentity, runIdAt, storeRun, useFreshDataDir } from '../runs/run-fixtures';
import {
	callTool,
	connect,
	TestProcesses,
	testEnvironment,
	toolCall,
	toolResultOf,
	writeTestPatch
} from './server-harness';

/** A background review that never takes its run over, so each start stays in its handover. */
const HOLDING_REVIEW = [process.execPath, new URL('../runs/background-fixture.ts', import.meta.url).pathname, 'hold'];

const processes = new TestProcesses();

afterEach(() => processes.reset());

useFreshDataDir();

/** The run id a start handed its background process. */
function runIdIn(argv: readonly string[]): RunId {
	return parseRunId(argv[argv.indexOf('--run-id') + 1]);
}

test('cancelling a start in its handover stops that start alone and signals no process', async () => {
	const server = await connect(testEnvironment(HOLDING_REVIEW, processes));
	const diff = writeTestPatch();

	server.send(toolCall(1, 'recoder_review', { diff }));

	const [first] = await processes.untilSpawned(1);

	server.send(toolCall(2, 'recoder_review', { diff }));

	const [, second] = await processes.untilSpawned(2);

	server.send(toolCall(3, 'recoder_cancel', { runId: runIdIn(first.argv) }));

	const cancelled = JSON.parse(toolResultOf(await server.replyTo(3)).text);

	server.send({ jsonrpc: '2.0', id: 4, method: 'ping' });

	expect(cancelled).toMatchObject({ state: 'cancelled', stopRequested: true });
	expect(toolResultOf(await server.replyTo(1)).isError).toBe(true);
	expect((await server.replyTo(4)).result).toEqual({});
	expect((await readRunStatus(runIdIn(second.argv))).state).toBe('running');
	expect(second.child.killed).toBe(false);
	expect(processes.stopped).toEqual([]);

	server.close();
	await server.served;
});

test('an error that tells the reader to run a command names the tool for it instead', async () => {
	const { text, isError } = await callTool('recoder_status', { runId: runIdAt(9) }, processes);

	expect(isError).toBe(true);
	expect(text).toContain('recoder_runs');
	expect(text).not.toContain('recoder runs');
});

test('a thrown hint to run recoder wait names the tool for it', async () => {
	const { pid, processStartedAt } = await liveIdentity();

	await storeRun(runIdAt(1), { pid, processStartedAt });

	const { text, isError } = await callTool('recoder_result', { runId: runIdAt(1) }, processes);

	expect(isError).toBe(true);
	expect(text).toContain(`call recoder_wait ${runIdAt(1)} first`);
});

test("a hint in a run's own error names the tool for it, and keeps the capital that starts the sentence", async () => {
	await storeRun(runIdAt(1), {
		...COMPLETE,
		state: 'failed',
		exitCode: 4,
		findings: null,
		error: 'No model. Run `recoder doctor`.'
	});

	const { text } = await callTool('recoder_result', { runId: runIdAt(1) }, processes);

	expect(text).toBe('No model. Call recoder_doctor.');
});

test("recoder_result returns a finished run's stored report", async () => {
	await storeRun(runIdAt(1), COMPLETE);
	await saveReport(runFiles(runIdAt(1)), report({ summary: 'Reviewed one file.' }));

	const { text, isError } = await callTool('recoder_result', { runId: runIdAt(1) }, processes);

	expect(isError).toBe(false);
	expect(JSON.parse(text)).toMatchObject({ outcome: 'complete', summary: 'Reviewed one file.' });
});

test("recoder_result of a run that ended without a report is a tool error carrying the run's error", async () => {
	await storeRun(runIdAt(1), { ...COMPLETE, state: 'failed', exitCode: 3, findings: null, error: 'no model is set' });

	expect(await callTool('recoder_result', { runId: runIdAt(1) }, processes)).toEqual({
		text: 'no model is set',
		isError: true
	});
});

test("recoder_runs with repo lists only that repository's runs, and its limit counts after that filter", async () => {
	const kept = join(tmpdir(), 'kept-repo');

	await storeRun(runIdAt(1), { ...COMPLETE, repoPath: kept });
	await storeRun(runIdAt(2), { ...COMPLETE, repoPath: join(tmpdir(), 'other-repo') });
	await storeRun(runIdAt(3), { ...COMPLETE, repoPath: kept });

	const { text } = await callTool('recoder_runs', { repo: 'kept-repo', limit: 2 }, processes);
	const listed: { runId: string }[] = JSON.parse(text);

	expect(listed.map((run) => run.runId)).toEqual([runIdAt(3), runIdAt(1)]);
});
