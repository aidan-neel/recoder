import { expect, test } from 'bun:test';
import type { ExecutionProfile } from '../../../../src/review/pipeline/harness/exec-profile';
import { classifyRun, commandPackage } from '../../../../src/review/pipeline/harness/run-outcome';

function profile(
	runner: ExecutionProfile['runner'],
	via: ExecutionProfile['transforms'][number]['via']
): ExecutionProfile {
	return {
		dir: 'pkg',
		runtime: runner === 'bun test' ? 'bun' : 'node',
		packageManager: 'bun',
		runner,
		transforms: [{ name: 'svelte', via }],
		generation: [],
		setupFiles: [],
		smoke: null
	};
}

const failed = (output: string) => ({ exitCode: 1, output, timedOut: false });

test('runs that execute no test or code, or never finished, reach no outcome', () => {
	expect(classifyRun('cat src/a.ts', failed('No such file'), null)).toBeUndefined();
	expect(classifyRun('bun run build', failed('error'), null)).toBeUndefined();
	expect(classifyRun('bun test a.test.ts', { exitCode: null, output: '', timedOut: true }, null)).toBeUndefined();
});

test('a run of code that needed a transform the executor never applies is unsupported execution', () => {
	const bunOnly = profile('bun test', []);
	const vitest = profile('vitest', ['vitest']);

	expect(
		classifyRun('cd pkg && bun test src/a.test.ts', failed('ReferenceError: $state is not defined'), bunOnly)
	).toBe('unsupported-execution');

	expect(classifyRun('bun src/lib.svelte.ts', failed('SyntaxError: Unexpected token'), vitest)).toBe(
		'unsupported-execution'
	);

	expect(
		classifyRun('npm test', failed('Error [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".svelte"'), vitest)
	).toBe('assertion-failed');

	expect(
		classifyRun('node a.mjs', failed('Error [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".svelte"'), vitest)
	).toBe('unsupported-execution');
});

test('a run that never got past a missing module, script or binary failed in setup', () => {
	const vitest = profile('vitest', ['vitest']);

	expect(classifyRun('bunx vitest run a.test.ts', failed('Error: Failed to resolve import "./gen/x.js"'), vitest)).toBe(
		'setup-failed'
	);

	expect(classifyRun('bun test a.test.ts', failed("error: Cannot find module './generated/value.js'"), null)).toBe(
		'setup-failed'
	);

	expect(classifyRun('bun run test:unit', failed('error: Script not found "test:unit"'), null)).toBe('setup-failed');
});

test('a run that reached its assertion passed or failed on it', () => {
	const vitest = profile('vitest', ['vitest']);

	expect(classifyRun('bunx vitest run a.test.ts', { exitCode: 0, output: '1 passed', timedOut: false }, vitest)).toBe(
		'assertion-passed'
	);

	expect(classifyRun('bunx vitest run a.test.ts | tail -5', failed('AssertionError: expected 1 to be 2'), vitest)).toBe(
		'assertion-failed'
	);

	expect(classifyRun('node -e "assert.equal(1, 2)"', failed('AssertionError'), null)).toBe('assertion-failed');
});

test('the package a command runs in', () => {
	const dirs = ['.', 'apps/docs', 'packages/sivir'];

	expect(commandPackage('cd apps/docs && bunx vitest run x.test.ts', dirs)).toBe('apps/docs');
	expect(commandPackage('cd ./packages/sivir/src && bun test', dirs)).toBe('packages/sivir');
	expect(commandPackage('bun test packages/sivir/src/a.test.ts', dirs)).toBe('packages/sivir');
	expect(commandPackage('bun -e "1"', dirs)).toBe('.');
	expect(commandPackage('bun -e "1"', ['apps/docs'])).toBeNull();
});
