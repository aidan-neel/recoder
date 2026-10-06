import { expect, test } from 'bun:test';
import { EvidenceStore } from '../../../../src/evidence/evidence';
import { runOnBaseline } from '../../../../src/review/pipeline/harness/verify-baseline';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { baseRecord } from '../../../../src/review/pipeline/verify/baseline';
import type { RunResult } from '../../../../src/sandbox/exec-sandbox';
import type { ExecWorkspace } from '../../../../src/sandbox/exec-workspace';

const COMMAND = 'bun test src/queue.test.ts';

/** `bun test` output failing `name` with `received` where 3 was expected. */
const failing = (name: string, received: number) =>
	`error: expect(received).toBe(expected)\n\nExpected: 3\nReceived: ${received}\n\n      at <anonymous> (/repo/src/queue.test.ts:7:20)\n(fail) ${name} [0.4ms]\n 1 fail\n`;

/** A sandbox whose base runs end as `ends` says, in order, and whose installs and tools are known. */
class FakeSandbox {
	readonly baseRuns: string[] = [];
	readonly preparedWith = 'bun install --frozen-lockfile';

	constructor(private readonly ends: (RunResult | { unavailable: string })[]) {}

	async runOnBase(command: string): Promise<RunResult | { unavailable: string }> {
		this.baseRuns.push(command);

		return this.ends.shift() ?? { unavailable: 'no more runs' };
	}

	async checkInputs() {
		return {
			scope: 'repo',
			headSha: 'head',
			dependencies: 'f00d',
			tools: `linux-x64\nbun 1.4.2\n${this.preparedWith}`
		};
	}
}

/** A finished base run that printed `output`. */
const ended = (exitCode: number, output: string): RunResult => ({
	exitCode,
	output,
	truncated: false,
	timedOut: false,
	elapsedMs: 1
});

/** The base comparison of a head run failing `caps the queue`, on `sandbox`. */
async function compare(sandbox: FakeSandbox) {
	const evidence = new EvidenceStore(null, buildInventory(''), 20_000);
	const proof = { ...baseRecord(COMMAND, 1, failing('caps the queue', 4)), id: 'ev_1', revision: 'head' as const };

	evidence.records.set(proof.id, proof);

	return runOnBaseline(
		proof.id,
		'The cap is off by one.',
		{
			evidence,
			workspace: sandbox as unknown as ExecWorkspace,
			mergeBaseSha: 'base',
			deadlineAt: () => Number.POSITIVE_INFINITY,
			signal: new AbortController().signal,
			changes: () => ({ added: [], removed: [], symbols: [] })
		},
		'verifier-1'
	);
}

test('a base failing for another cause is run once more, and runs that disagree are unstable', async () => {
	const sandbox = new FakeSandbox([ended(1, failing('parses dates', 1)), ended(0, ' 4 pass\n')]);
	const baseline = await compare(sandbox);

	expect(sandbox.baseRuns).toEqual([COMMAND, COMMAND]);

	expect(baseline).toMatchObject({
		unavailable: 'repeated runs on the base commit disagree',
		result: 'unstable',
		head: { exitCode: 1, runtime: 'linux-x64, bun 1.4.2', dependencies: 'f00d' },
		baseRuns: [{ exitCode: 1 }, { exitCode: 0, failure: null }]
	});
});

test('a base failing for another cause twice the same way keeps its class', async () => {
	const sandbox = new FakeSandbox([ended(1, failing('parses dates', 1)), ended(1, failing('parses dates', 1))]);

	expect(await compare(sandbox)).toMatchObject({ differs: true, result: 'worsened', baseRuns: [{}, {}] });
	expect(sandbox.baseRuns).toHaveLength(2);
});

test('a base failing for the head cause, or passing, is run once', async () => {
	for (const [end, result] of [
		[ended(1, failing('caps the queue', 4)), 'pre-existing'],
		[ended(0, ' 4 pass\n'), 'regression']
	] as const) {
		const sandbox = new FakeSandbox([end]);

		expect(await compare(sandbox)).toMatchObject({ result, baseRuns: [{ exitCode: end.exitCode }] });
		expect(sandbox.baseRuns).toHaveLength(1);
	}
});

test('a base tree that could not be built is the environment', async () => {
	const sandbox = new FakeSandbox([{ unavailable: 'the dependency manifests changed' }]);

	expect(await compare(sandbox)).toMatchObject({
		unavailable: 'the dependency manifests changed',
		result: 'environment',
		head: { exitCode: 1 },
		baseRuns: []
	});
});

test('a rerun that could not be built keeps the first run', async () => {
	const sandbox = new FakeSandbox([ended(1, failing('parses dates', 1)), { unavailable: 'the review is out of time' }]);

	expect(await compare(sandbox)).toMatchObject({ result: 'worsened', baseRuns: [{ exitCode: 1 }] });
	expect(sandbox.baseRuns).toHaveLength(2);
});
