import { mkdtemp, rm } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Runs the whole server suite as several `bun test --isolate` processes that pull batches of files from one queue,
 * and prints only what failed. One plain `bun test` takes four times as long, and `bun test --parallel` workers can
 * spin forever inside `Bun.spawnSync` (seen on Bun 1.4.2 under load), which no test timeout interrupts.
 */

const SERVER_ROOT = join(import.meta.dir, '..');

const INTEGRATION_FOLDER = 'tests/integration/';

/** What opts a test into the HA suite's PostgreSQL. A unit run never sees them, so it cannot reach that database. */
const HA_DATABASE_VARIABLES = ['TEST_DATABASE_URL', 'RECODER_POSTGRES_TEST_URL'];

/** Files per `bun test` process: enough that starting a process is noise, few enough that the workers stay balanced. */
const BATCH_SIZE = 6;

/** Every test has its own five-second timeout, so a batch still running after this long is hung, not slow. */
const BATCH_TIMEOUT_MS = 240_000;

interface BatchResult {
	passed: boolean;
	output: string;
}

const startedAt = performance.now();
const files = await testFiles();
const results = await runBatches(batchesOf(files));
const failures = results.filter((result) => !result.passed);
const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);

for (const failure of failures) console.log(failure.output);

if (failures.length > 0) {
	console.log(`${failures.length} of ${results.length} batches failed (${files.length} test files, ${seconds}s)`);
	process.exitCode = 1;
} else {
	console.log(`${files.length} test files passed in ${seconds}s`);
}

/**
 * Every unit test file, as a `./` path so `bun test` takes it as that file and not as a name to match. The
 * integration suite shares one PostgreSQL database, so it runs on its own (`test:ha`), never in these batches.
 */
async function testFiles(): Promise<string[]> {
	const found = await Array.fromAsync(new Bun.Glob('tests/**/*.test.ts').scan({ cwd: SERVER_ROOT }));

	return found
		.filter((file) => !file.startsWith(INTEGRATION_FOLDER))
		.sort()
		.map((file) => `./${file}`);
}

/**
 * Deals the sorted files out like cards, so each batch draws from every folder. Slicing the list instead would put
 * a folder of slow tests (the agent adapters, which all spawn processes) on every worker at once.
 */
function batchesOf(all: string[]): string[][] {
	const batches: string[][] = Array.from({ length: Math.ceil(all.length / BATCH_SIZE) }, () => []);

	all.forEach((file, index) => batches[index % batches.length].push(file));

	return batches;
}

/** One worker per core, each taking the next batch as it finishes its last, so a slow batch holds up only itself. */
async function runBatches(batches: string[][]): Promise<BatchResult[]> {
	const queue = [...batches];
	const workers = Array.from({ length: Math.min(availableParallelism(), queue.length) }, () => drain(queue));

	return (await Promise.all(workers)).flat();
}

async function drain(queue: string[][]): Promise<BatchResult[]> {
	const results: BatchResult[] = [];

	for (let batch = queue.shift(); batch; batch = queue.shift()) results.push(await runBatch(batch));

	return results;
}

function unitTestEnv(temp: string): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = { ...process.env, TMPDIR: temp };

	for (const name of HA_DATABASE_VARIABLES) delete env[name];

	return env;
}

/**
 * Gives the batch a temp dir of its own and deletes it afterwards. Tests make their fixtures under `tmpdir()` and
 * most never remove them, which left over a hundred thousand folders (6 GB) behind on one machine.
 */
async function runBatch(batch: string[]): Promise<BatchResult> {
	const temp = await mkdtemp(join(tmpdir(), 'recoder-tests-'));

	try {
		return await runBatchIn(temp, batch);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
}

async function runBatchIn(temp: string, batch: string[]): Promise<BatchResult> {
	const child = Bun.spawn([process.execPath, 'test', '--isolate', '--only-failures', ...batch], {
		cwd: SERVER_ROOT,
		env: unitTestEnv(temp),
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: BATCH_TIMEOUT_MS
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited
	]);

	if (child.signalCode) {
		return { passed: false, output: `${stdout}${stderr}\nStopped by ${child.signalCode}: ${batch.join(' ')}` };
	}

	return { passed: exitCode === 0, output: `${stdout}${stderr}` };
}
