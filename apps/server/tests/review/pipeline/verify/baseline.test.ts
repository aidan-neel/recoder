import { expect, test } from 'bun:test';
import type { FindingVerification } from '@recoder/shared';
import { baseRecord, compareToBase, withBaseline } from '../../../../src/review/pipeline/verify/baseline';

/** The proving run on the head: `output` and `exitCode` of `bun repro.ts`. */
const head = (output: string, exitCode: number) => baseRecord('bun repro.ts', exitCode, output);

test('a command that passes on the base commit differs from one that failed on the head', () => {
	expect(
		compareToBase(head('returned NaN', 1), 'It prints `returned NaN`.', baseRecord('bun repro.ts', 0, 'ok'))
	).toEqual({
		exitCode: 0,
		differs: true
	});
});

test('a command that fails the same way on the base commit does not differ', () => {
	const base = baseRecord('bun repro.ts', 1, 'error: returned NaN');

	expect(compareToBase(head('returned NaN', 1), 'It prints `returned NaN`.', base)).toEqual({
		exitCode: 1,
		differs: false
	});
});

test('a command that fails without the quoted output on the base commit differs', () => {
	const base = baseRecord('bun repro.ts', 1, 'error: something else');

	expect(compareToBase(head('returned NaN', 1), 'It prints `returned NaN`.', base)).toMatchObject({ differs: true });
});

test('a base run that stopped before the code under test is unavailable', () => {
	const base = baseRecord('bun repro.ts', 1, "error: Cannot find module './a'");

	expect(compareToBase(head('returned NaN', 1), 'It fails.', base)).toEqual({
		unavailable: expect.any(String)
	});

	expect(compareToBase(head('returned NaN', 1), 'It fails.', baseRecord('bun repro.ts', null, ''))).toEqual({
		unavailable: expect.any(String)
	});
});

test('a base run that a bundler stopped at an import it could not load is unavailable, not the same failure', () => {
	const command = 'cd pkg && bunx vitest run src/queue.test.ts';
	const proof = baseRecord(command, 1, 'FAIL src/queue.test.ts > caps the queue\nAssertionError: expected 4 to be 3');

	const base = baseRecord(
		command,
		1,
		'Error: Failed to resolve import "../generated/limits" from "src/queue.ts". Does the file exist?'
	);

	expect(base.outcome).toBe('setup-failed');

	expect(compareToBase(proof, 'The queue cap is off by one.', base)).toEqual({
		unavailable: 'the command could not run on the base commit'
	});

	expect(
		compareToBase(
			proof,
			'The queue cap is off by one.',
			baseRecord(command, 1, 'error: Cannot find module "../generated/limits.js"')
		)
	).toEqual({ unavailable: 'the command could not run on the base commit' });
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
