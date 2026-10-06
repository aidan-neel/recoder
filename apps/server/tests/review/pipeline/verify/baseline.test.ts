import { expect, test } from 'bun:test';
import type { FindingVerification } from '@recoder/shared';
import type { DiffChanges } from '../../../../src/review/pipeline/harness/run-outcome';
import {
	ambiguousBase,
	baseRecord,
	compareToBase,
	withBaseline
} from '../../../../src/review/pipeline/verify/baseline';

/** The proving run on the head: `output` and `exitCode` of `bun repro.ts`. */
const head = (output: string, exitCode: number) => baseRecord('bun repro.ts', exitCode, output);

const NOTHING: DiffChanges = { added: [], removed: [], symbols: [] };

const COMMAND = 'bun test src/queue.test.ts';

/** `bun test` output: each failing test with its assertion, then the runner's counts. */
function bunTest(failures: { test: string; expected: number; received: number }[], root = '/work/repo'): string {
	const blocks = failures.map(({ test, expected, received }) =>
		[
			'error: expect(received).toBe(expected)',
			'',
			`Expected: ${expected}`,
			`Received: ${received}`,
			'',
			`      at <anonymous> (${root}/src/queue.test.ts:7:20)`,
			`(fail) ${test} [0.40ms]`
		].join('\n')
	);

	return ['bun test v1.4.2', ...blocks, '', ` 3 pass`, ` ${failures.length} fail`].join('\n');
}

const CAP = { test: 'caps the queue', expected: 3, received: 4 };
const DATES = { test: 'parses dates', expected: 2, received: 1 };

/** A head run of `COMMAND` failing `failures`. */
const headRun = (...failures: (typeof CAP)[]) => baseRecord(COMMAND, 1, bunTest(failures));

/** A base run of `COMMAND` failing `failures`, from the base tree's path. */
const baseRun = (...failures: (typeof CAP)[]) => baseRecord(COMMAND, 1, bunTest(failures, '/cache/base-0123456789ab'));

test('a command that passes on the base commit is a regression', () => {
	expect(
		compareToBase(head('returned NaN', 1), 'It prints `returned NaN`.', [baseRecord('bun repro.ts', 0, 'ok')], NOTHING)
	).toMatchObject({ exitCode: 0, differs: true, result: 'regression' });
});

test('a command that fails for the same cause on the base commit is pre-existing', () => {
	const base = baseRecord('bun repro.ts', 1, 'error: returned NaN');

	expect(compareToBase(head('returned NaN', 1), 'It prints `returned NaN`.', [base], NOTHING)).toMatchObject({
		exitCode: 1,
		differs: false,
		result: 'pre-existing'
	});

	expect(compareToBase(headRun(CAP), 'The cap is off by one.', [baseRun(CAP)], NOTHING)).toMatchObject({
		differs: false,
		result: 'pre-existing'
	});
});

test('the same exit code with a different failing cause is not the same failure', () => {
	const base = baseRecord('bun repro.ts', 1, 'error: something else');

	expect(compareToBase(head('returned NaN', 1), 'It prints `returned NaN`.', [base], NOTHING)).toMatchObject({
		differs: true,
		result: 'worsened'
	});

	expect(compareToBase(headRun(CAP), 'The cap is off by one.', [baseRun(DATES)], NOTHING)).toMatchObject({
		exitCode: 1,
		differs: true,
		result: 'worsened'
	});
});

test('a pre-existing failure the head fails more often is worsened', () => {
	expect(compareToBase(headRun(CAP, DATES), 'Both fail.', [baseRun(DATES)], NOTHING)).toMatchObject({
		differs: true,
		result: 'worsened'
	});

	const worse = baseRecord(COMMAND, 1, bunTest([CAP]).replace(' 1 fail', ' 4 fail'));

	expect(compareToBase(worse, 'The cap is off by one.', [baseRun(CAP)], NOTHING)).toMatchObject({ result: 'worsened' });
});

test('a base failing only an unrelated test, and passing the head failure, is a regression', () => {
	const base = baseRecord(COMMAND, 1, `${bunTest([DATES])}\n(pass) caps the queue [0.1ms]`);

	expect(compareToBase(headRun(CAP), 'The cap is off by one.', [base], NOTHING)).toMatchObject({
		differs: true,
		result: 'regression'
	});
});

test('a base that cannot import a module or call a function the diff added is incompatible and settles nothing', () => {
	const added: DiffChanges = { added: ['src/limits.ts'], removed: [], symbols: ['queueLimit'] };
	const missing = baseRecord(COMMAND, 1, "error: Cannot find module './limits' from '/cache/base-1/src/queue.ts'");
	const uncalled = baseRecord(COMMAND, 1, 'TypeError: queueLimit is not a function\n(fail) caps the queue');

	for (const base of [missing, uncalled]) {
		expect(compareToBase(headRun(CAP), 'The cap is off by one.', [base], added)).toMatchObject({
			unavailable: 'the base commit cannot run the new API or fixture',
			result: 'incompatible'
		});
	}
});

test('a missing fixture on the base cannot make a new head regression pre-existing', () => {
	const changes: DiffChanges = { added: ['fixtures/limits.json'], removed: [], symbols: [] };
	const proof = baseRecord(COMMAND, 1, bunTest([CAP]));

	const base = baseRecord(
		COMMAND,
		1,
		"error: ENOENT: no such file or directory, open '/cache/base-1/fixtures/limits.json'\n(fail) caps the queue"
	);

	const baseline = compareToBase(proof, 'The cap is off by one.', [base], changes);

	expect(baseline).toMatchObject({ result: 'incompatible', unavailable: expect.any(String) });
	expect(ambiguousBase(proof, 'The cap is off by one.', base, changes)).toBe(false);

	const verified: FindingVerification = {
		status: 'verified',
		method: 'run',
		reason: 'The cap is off by one.',
		evidence: { command: COMMAND, exitCode: 1, observed: 'x', evidenceId: 'ev_1' }
	};

	expect(withBaseline(verified, baseline).reason).toBe(verified.reason);

	const unrelated = compareToBase(proof, 'The cap is off by one.', [base], NOTHING);

	expect(unrelated).toMatchObject({ result: 'environment', unavailable: expect.any(String) });
	expect(withBaseline(verified, unrelated).reason).toBe(verified.reason);
});

test('a base run that stopped before the code under test is the environment and settles nothing', () => {
	expect(
		compareToBase(
			head('returned NaN', 1),
			'It fails.',
			[baseRecord('bun repro.ts', 1, "error: Cannot find module './a'")],
			NOTHING
		)
	).toMatchObject({ unavailable: 'the command could not run on the base commit', result: 'environment' });

	expect(
		compareToBase(head('returned NaN', 1), 'It fails.', [baseRecord('bun repro.ts', null, '')], NOTHING)
	).toMatchObject({ unavailable: 'the command did not finish there', result: 'environment' });
});

test('a base run that a bundler stopped at an import it could not load is the environment, not the same failure', () => {
	const command = 'cd pkg && bunx vitest run src/queue.test.ts';
	const proof = baseRecord(command, 1, 'FAIL src/queue.test.ts > caps the queue\nAssertionError: expected 4 to be 3');

	const base = baseRecord(
		command,
		1,
		'Error: Failed to resolve import "../generated/limits" from "src/queue.ts". Does the file exist?'
	);

	expect(base.outcome).toBe('setup-failed');

	expect(compareToBase(proof, 'The queue cap is off by one.', [base], NOTHING)).toMatchObject({
		unavailable: 'the command could not run on the base commit',
		result: 'environment'
	});
});

test('base runs that disagree are unstable and settle nothing; runs that agree keep the class', () => {
	expect(compareToBase(headRun(CAP), 'The cap is off by one.', [baseRun(DATES), baseRun(CAP)], NOTHING)).toMatchObject({
		unavailable: 'repeated runs on the base commit disagree',
		result: 'unstable'
	});

	const passedAgain = baseRecord(COMMAND, 0, ' 4 pass');

	expect(compareToBase(headRun(CAP), 'The cap is off by one.', [baseRun(DATES), passedAgain], NOTHING)).toMatchObject({
		result: 'unstable'
	});

	expect(
		compareToBase(headRun(CAP), 'The cap is off by one.', [baseRun(DATES), baseRun(DATES)], NOTHING)
	).toMatchObject({
		differs: true,
		result: 'worsened'
	});
});

test('only a base failure that is not the head cause is ambiguous enough to run again', () => {
	expect(ambiguousBase(headRun(CAP), 'Off by one.', baseRun(DATES), NOTHING)).toBe(true);
	expect(ambiguousBase(headRun(CAP), 'Off by one.', baseRun(CAP), NOTHING)).toBe(false);
	expect(ambiguousBase(headRun(CAP), 'Off by one.', baseRecord(COMMAND, 0, ' 4 pass'), NOTHING)).toBe(false);

	expect(ambiguousBase(headRun(CAP), 'Off by one.', baseRecord(COMMAND, 1, 'error: Script not found'), NOTHING)).toBe(
		false
	);
});

test('a comparison records each run with its failing assertion, location, exit code, runtime and dependencies', () => {
	const identity = { runtime: 'linux-x64, bun 1.4.2', dependencies: 'f00d' };

	expect(compareToBase(headRun(CAP), 'The cap is off by one.', [baseRun(CAP)], NOTHING, identity)).toMatchObject({
		head: {
			exitCode: 1,
			failure: 'error: expect(received).toBe(expected)',
			location: '/work/repo/src/queue.test.ts:7:20',
			...identity
		},
		baseRuns: [{ exitCode: 1, location: '/cache/base-0123456789ab/src/queue.test.ts:7:20', ...identity }]
	});
});

test('a verification that ends the same way on the base commit stays verified and says so', () => {
	const verified: FindingVerification = {
		status: 'verified',
		method: 'run',
		outcome: 'reproduced',
		reason: 'The repro fails.',
		evidence: { command: 'bun repro.ts', exitCode: 1, observed: 'x', evidenceId: 'ev_1' }
	};

	const same = withBaseline(verified, { exitCode: 1, differs: false });

	expect(same).toMatchObject({ status: 'verified', outcome: 'reproduced' });
	expect(same.reason).not.toBe(verified.reason);
	expect(same.evidence?.baseline).toEqual({ exitCode: 1, differs: false });

	expect(withBaseline(verified, { exitCode: 0, differs: true }).reason).toBe(verified.reason);
	expect(withBaseline(verified, { unavailable: 'no base' })).toMatchObject({ reason: verified.reason });
});
