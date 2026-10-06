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

	expect(classifyRun('bun src/lib.svelte.ts', failed('ReferenceError: $derived is not defined'), vitest)).toBe(
		'unsupported-execution'
	);

	expect(
		classifyRun('npm test', failed('Error [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".svelte"'), vitest)
	).toBe('assertion-failed');

	expect(
		classifyRun('node a.mjs', failed('Error [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".svelte"'), vitest)
	).toBe('unsupported-execution');
});

test('a file name alone never makes a run unsupported: rune-free code under bare bun reaches its assertion', () => {
	const repro = `bun -e "import { double } from './src/util.svelte.ts'; if (double(1) !== 2) process.exit(1)"`;

	expect(classifyRun(repro, failed('expected 2, got 3'), profile('bun test', []))).toBe('assertion-failed');

	expect(
		classifyRun('bun src/lib.svelte.ts', failed('SyntaxError: Unexpected token'), profile('vitest', ['vitest']))
	).toBe('assertion-failed');
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

test('a run that could not download a package offline failed in setup', () => {
	const vitest = profile('vitest', ['vitest']);

	for (const output of [
		'error: DNSResolveFailed downloading package manifest vitest',
		'npm error getaddrinfo ENOTFOUND registry.npmjs.org',
		'Error: getaddrinfo EAI_AGAIN registry.npmjs.org'
	]) {
		expect(classifyRun('bunx vitest run a.test.ts', failed(output), vitest)).toBe('setup-failed');
	}
});

test('untransformed code is unsupported in a package whose own profile names no transform', () => {
	const root: ExecutionProfile = { ...profile('bun test', []), dir: '.', transforms: [] };

	expect(classifyRun('bun repro.ts', failed('ReferenceError: $state is not defined'), root)).toBe(
		'unsupported-execution'
	);

	expect(classifyRun('bun repro.ts', failed('ReferenceError: $state is not defined'), null)).toBe(
		'unsupported-execution'
	);

	expect(
		classifyRun(
			'bunx vitest run a.test.ts',
			failed('ReferenceError: $state is not defined'),
			profile('vitest', ['vitest'])
		)
	).toBe('assertion-failed');
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
	const dirs = ['.', 'apps/site', 'packages/widgets'];

	expect(commandPackage('cd apps/site && bunx vitest run x.test.ts', dirs)).toBe('apps/site');
	expect(commandPackage('cd ./packages/widgets/src && bun test', dirs)).toBe('packages/widgets');
	expect(commandPackage('bun test packages/widgets/src/a.test.ts', dirs)).toBe('packages/widgets');
	expect(commandPackage('bun -e "1"', dirs)).toBe('.');
	expect(commandPackage('bun -e "1"', ['apps/site'])).toBeNull();
});

test('a run that cannot find a module the diff deleted or moved failed on the change, not in setup', () => {
	const moved = ['src/limits.ts', 'src/config/limits.ts'];

	expect(
		classifyRun(
			'bun test src/queue.test.ts',
			failed("error: Cannot find module './limits' from '/work/src/queue.ts'"),
			null,
			moved
		)
	).toBe('assertion-failed');

	expect(
		classifyRun(
			'cd pkg && bunx vitest run',
			failed('Error: Failed to resolve import "../limits.js" from "src/config/queue.ts". Does the file exist?'),
			null,
			['pkg/src/limits.ts']
		)
	).toBe('assertion-failed');

	expect(
		classifyRun(
			'node src/main.mjs',
			failed(
				"Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/work/src/config/limits.js' imported from /work/src/main.mjs"
			),
			null,
			moved
		)
	).toBe('assertion-failed');
});

test('a run that cannot find a module the diff never touched, or a package, stays setup-failed', () => {
	const diff = ['src/limits.ts'];

	expect(
		classifyRun(
			'bun test src/queue.test.ts',
			failed("error: Cannot find module './generated/limits' from '/work/src/q.ts'"),
			null,
			diff
		)
	).toBe('setup-failed');

	expect(classifyRun('bun test src/queue.test.ts', failed("error: Cannot find package 'limits'"), null, diff)).toBe(
		'setup-failed'
	);

	expect(classifyRun('bun test src/queue.test.ts', failed("error: Cannot find module './limits'"), null)).toBe(
		'setup-failed'
	);
});
