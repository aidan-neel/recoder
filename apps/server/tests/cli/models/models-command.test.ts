import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT } from '../../../src/cli/exit';
import { fakeBin } from '../../helpers/fake-bin';
import { childEnvironment } from '../child-env';
import { HANGING_DEVIN, startedProcess, stoppedProcess } from '../run/hanging-devin';

const MAIN = new URL('../../../src/cli/main.ts', import.meta.url).pathname;

const dataDirs: string[] = [];

afterEach(() => {
	for (const dir of dataDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The variables of a machine with no agent set up: both agent CLIs are pinned to none, whatever is on PATH. */
function machineWithoutAgents(): Record<string, string> {
	const dir = mkdtempSync(join(tmpdir(), 'recoder-models-'));

	dataDirs.push(dir);

	return { ...childEnvironment(dir), RECODER_DEVIN_BIN: '' };
}

/** Runs `recoder models` with these arguments and returns what it wrote and how it ended. */
async function runModels(env: Record<string, string>, args: string[] = []) {
	const child = Bun.spawn([process.execPath, MAIN, 'models', ...args], { env, stdout: 'pipe', stderr: 'pipe' });

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited
	]);

	return { stdout, stderr, exitCode };
}

test('recoder models prints one line of JSON and exits 0, with no problem for agents that are not installed', async () => {
	const { stdout, exitCode } = await runModels(machineWithoutAgents());
	const lines = stdout.trimEnd().split('\n');

	expect(exitCode).toBe(EXIT.ok);
	expect(lines).toHaveLength(1);

	expect(JSON.parse(lines[0])).toMatchObject({
		reviewer: null,
		worker: null,
		models: expect.arrayContaining([expect.objectContaining({ provider: 'Claude Code' })]),
		problems: []
	});
});

test('--search that matches nothing lists no model and still exits 0', async () => {
	const { stdout, exitCode } = await runModels(machineWithoutAgents(), ['--search', 'no-such-model']);

	expect(exitCode).toBe(EXIT.ok);
	expect(JSON.parse(stdout)).toMatchObject({ models: [] });
});

test('an unknown --provider is a usage error that lists the providers, and prints nothing on standard output', async () => {
	const { stdout, stderr, exitCode } = await runModels(machineWithoutAgents(), ['--provider', 'Nowhere']);

	expect(exitCode).toBe(EXIT.usage);
	expect(stdout).toBe('');
	expect(stderr).toContain('Claude Code');
});

test('a signal while Devin lists its models stops the process, ends the listing and exits 130', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'recoder-models-'));

	dataDirs.push(dir);

	const { env: pathEnv } = await fakeBin('devin', HANGING_DEVIN);
	const env = { ...childEnvironment(dir), PATH: pathEnv.PATH, FAKE_DEVIN_DIR: dir };
	const started = startedProcess(dir);
	const stopped = stoppedProcess(dir);
	const child = Bun.spawn([process.execPath, MAIN, 'models'], { env, stdout: 'pipe', stderr: 'ignore' });

	await started;
	child.kill('SIGTERM');

	expect(await child.exited).toBe(EXIT.cancelled);
	await stopped;
});
