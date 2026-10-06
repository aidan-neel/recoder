import { expect, test } from 'bun:test';
import { baseRecord } from '../../../../src/review/pipeline/verify/baseline';
import { runCause, sameCause, sameCauses } from '../../../../src/review/pipeline/verify/cause';

/** `bun test` failing one assertion, as it prints without colours, from a checkout at `root`. */
const bunFailure = (root: string, received: number) =>
	[
		'bun test v1.4.2 (744846f84)',
		'',
		'queue.test.ts:',
		"3 | test('caps the queue', () => { expect(cap(5)).toBe(3); });",
		'                                                  ^',
		'error: expect(received).toBe(expected)',
		'',
		'Expected: 3',
		`Received: ${received}`,
		'',
		`      at <anonymous> (${root}/src/queue.test.ts:3:47)`,
		'(fail) caps the queue [0.36ms]',
		'',
		' 1 pass',
		' 1 fail',
		'Ran 2 tests across 1 file. [38.00ms]'
	].join('\n');

const VITEST_FAILURE = [
	' FAIL  src/queue.test.ts > queue > caps the queue',
	'AssertionError: expected 4 to be 3 // Object.is equality',
	'',
	'- Expected',
	'+ Received',
	'',
	' ❯ src/queue.test.ts:5:20',
	'',
	' Test Files  1 failed (1)',
	'      Tests  2 failed | 1 passed (3)'
].join('\n');

test('a bun failure is read as its failing test, assertion values, first repo frame and failure count', () => {
	const cause = runCause(baseRecord('bun test src/queue.test.ts', 1, bunFailure('/work/repo', 4)));

	expect(cause).toEqual({
		failed: ['caps the queue'],
		passed: [],
		errors: ['error: expect(received).toBe(expected)', 'Expected: 3', 'Received: 4'],
		fallback: null,
		failure: 'error: expect(received).toBe(expected)',
		location: '/work/repo/src/queue.test.ts:3:47',
		failures: 1
	});
});

test('a vitest failure is read the same way', () => {
	const cause = runCause(baseRecord('bunx vitest run', 1, VITEST_FAILURE));

	expect(cause).toMatchObject({
		failed: ['src/queue.test.ts > queue > caps the queue'],
		errors: ['AssertionError: expected 4 to be 3 // Object.is equality'],
		location: 'src/queue.test.ts:5:20',
		failures: 2
	});
});

test('the same failure printed from the base tree path and the head checkout is the same cause', () => {
	const head = baseRecord('bun test', 1, bunFailure('/work/repo', 4));
	const base = baseRecord('bun test', 1, bunFailure('/cache/base-0123456789ab', 4));

	expect(sameCauses(runCause(head), runCause(base))).toBe(true);
	expect(sameCause(runCause(head), runCause(base), '')).toBe(true);
});

test('the same test failing with other values is not the same cause', () => {
	const head = runCause(baseRecord('bun test', 1, bunFailure('/work/repo', 5)));
	const base = runCause(baseRecord('bun test', 1, bunFailure('/work/repo', 4)));

	expect(sameCause(head, base, '')).toBe(false);
});

test('a failure that printed no error line is matched by its failure line in the other output', () => {
	const head = runCause(baseRecord('bun repro.ts', 1, 'loading\nreturned NaN'));

	expect(head).toMatchObject({ errors: [], fallback: 'returned NaN', failure: 'returned NaN' });
	expect(sameCause(head, runCause(baseRecord('bun repro.ts', 1, 'x')), 'loading\nreturned NaN\n')).toBe(true);
	expect(sameCause(head, runCause(baseRecord('bun repro.ts', 1, 'x')), 'returned 0\n')).toBe(false);
});
