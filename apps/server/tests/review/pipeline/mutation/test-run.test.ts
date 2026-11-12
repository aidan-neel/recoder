import { describe, expect, test } from 'bun:test';
import {
	mutantCommand,
	oldCopyPath,
	singleFileCommands,
	WRITE_FAILED_EXIT,
	type CommandPlan
} from '../../../../src/review/pipeline/mutation/test-run';
import { classifyRun, commandPackage } from '../../../../src/review/pipeline/harness/run-outcome';

const SOURCE = 'export function ok(n: number) {\n\treturn n >= 3;\n}';

/** The plan a source payload becomes, failing the test when the payload is skipped instead. */
function planFor(text: string): CommandPlan {
	const plan = mutantCommand({ source: { path: 'src/a.ts', text }, oldTest: null, run: 'bun test a.test.ts' });

	if (typeof plan === 'string') throw new Error(`expected a plan, got ${plan}`);

	return plan;
}

describe('singleFileCommands', () => {
	test('runs one file through the package test script', () => {
		const scripts = [
			'apps/x: test → xo && tsc && ava',
			'.: test → bun run build && bun test',
			'apps/y: test → turbo test'
		];

		const commandFor = singleFileCommands(scripts, ['cd apps/x && pnpm run test']);

		expect(commandFor('apps/x/test/a.ts')).toBe('cd apps/x && pnpm exec ava test/a.ts');
		expect(commandFor('lib/a.test.ts')).toBe('bun test lib/a.test.ts');
		expect(commandFor('apps/y/a.test.ts')).toBeNull();
		expect(commandFor('lib/a b.test.ts')).toBeNull();
	});

	test('follows a test script that only runs another script', () => {
		const scripts = ['docs: test → bun run test:ci', 'docs: test:ci → vitest run --project unit'];

		const commandFor = singleFileCommands(scripts, ['cd docs && bun run test']);

		expect(commandFor('docs/a.test.ts')).toBe(
			'cd docs && bunx vitest run --project unit --reporter=dot --coverage.enabled=false a.test.ts'
		);
	});
});

describe('singleFileCommands for bun test', () => {
	test('gives no command for a helper in a tests folder, which bun test would not run', () => {
		const commandFor = singleFileCommands(['.: test → bun test'], ['bun run test']);

		expect(commandFor('tests/helpers/review.ts')).toBeNull();
		expect(commandFor('tests/review.test.ts')).toBe('bun test tests/review.test.ts');
	});
});

describe('singleFileCommands by runner defaults', () => {
	test('runs an AVA file under test/ but not its helper, and a vitest file only with a marker', () => {
		const ava = singleFileCommands(['.: test → ava'], ['npm run test']);
		const vitest = singleFileCommands(['.: test → vitest run'], ['pnpm run test']);

		expect(ava('test/retry.ts')).toBe('npx ava test/retry.ts');
		expect(ava('test/helpers/server.ts')).toBeNull();
		expect(vitest('tests/helpers/server.ts')).toBeNull();
		expect(vitest('src/rate-limit/store.test.ts')).toContain('src/rate-limit/store.test.ts');
	});
});

describe('oldCopyPath', () => {
	test('keeps the test marker on the old copy', () => {
		expect(oldCopyPath('src/a.test.ts')).toBe('src/a.recoder-old.test.ts');
	});
});

describe('mutantCommand', () => {
	test('lands the mutant through scratch chunks, never on the command line', () => {
		expect(planFor(SOURCE)).toEqual({
			command: `cat -- .recoder-mutant.0 > src/a.ts || exit ${WRITE_FAILED_EXIT}; ( bun test a.test.ts ); rc=$?; exit $rc`,
			testCommand: 'bun test a.test.ts',
			files: [{ path: '.recoder-mutant.0', text: SOURCE }]
		});
	});

	test('splits a large source into chunks that concatenate back to it', () => {
		const text = 'x'.repeat(130_000);
		const plan = planFor(text);

		expect(plan.files.map((file) => file.path)).toEqual([
			'.recoder-mutant.0',
			'.recoder-mutant.1',
			'.recoder-mutant.2'
		]);

		expect(plan.files.every((file) => file.text.length <= 64_000)).toBe(true);
		expect(plan.files.map((file) => file.text).join('')).toBe(text);
		expect(plan.command).toContain('cat -- .recoder-mutant.0 .recoder-mutant.1 .recoder-mutant.2 > src/a.ts');
	});

	test('never splits a surrogate pair across chunks', () => {
		const text = `${'x'.repeat(59_999)}😀${'y'.repeat(70_000)}`;

		expect(
			planFor(text)
				.files.map((file) => file.text)
				.join('')
		).toBe(text);
	});

	test('places the old test at its recoder-old path as a scratch file the workspace removes', () => {
		const path = oldCopyPath('src/a.test.ts');
		const plan = mutantCommand({ source: null, oldTest: { path, text: 'old test' }, run: 'bun test a.test.ts' });

		expect(plan).toEqual({
			command: `( bun test a.test.ts ); rc=$?; exit $rc`,
			testCommand: 'bun test a.test.ts',
			files: [{ path, text: 'old test' }]
		});
	});

	test('rejects a path that is not plain', () => {
		const source = mutantCommand({ source: { path: 'src/a b.ts', text: SOURCE }, oldTest: null, run: 'x' });

		const oldTest = mutantCommand({
			source: null,
			oldTest: { path: 'src/a b.recoder-old.test.ts', text: 'x' },
			run: 'x'
		});

		expect(source).toBe('unsafe-path');
		expect(oldTest).toBe('unsafe-path');
	});

	test('rejects a payload past the chunk cap and an old test past the write limit', () => {
		const plans = [
			{ source: { path: 'src/a.ts', text: 'x'.repeat(480_001) }, oldTest: null, run: 'x' },
			{
				source: null,
				oldTest: { path: 'src/a.recoder-old.test.ts', text: 'x'.repeat(64_001) },
				run: 'x'
			}
		];

		for (const plan of plans) expect(mutantCommand(plan)).toBe('too-large');
	});
});

describe('mutantCommand classification', () => {
	const failed = (output: string) => ({ exitCode: 1, output, timedOut: false });

	/** A plan for a root-package run and one for a `cd` package run, as `singleFileCommands` builds them. */
	function plans() {
		const root = planFor(SOURCE);

		const nested = mutantCommand({
			source: { path: 'apps/x/src/a.ts', text: SOURCE },
			oldTest: null,
			run: 'cd apps/x && bunx vitest run src/a.test.ts'
		});

		if (typeof nested === 'string') throw new Error(`expected a plan, got ${nested}`);

		return { root, nested };
	}

	test('a missing module on the test command is setup-failed, not a kill', () => {
		const { root, nested } = plans();
		const missing = failed('error: Cannot find module "lodash"');

		expect(classifyRun(root.testCommand, missing, null)).toBe('setup-failed');
		expect(classifyRun(nested.testCommand, missing, null)).toBe('setup-failed');
	});

	test('a failed assertion on the test command is assertion-failed', () => {
		const { root, nested } = plans();
		const output = 'AssertionError: expected 1 to be 2';

		expect(classifyRun(root.testCommand, failed(output), null)).toBe('assertion-failed');
		expect(classifyRun(nested.testCommand, failed(output), null)).toBe('assertion-failed');
	});

	test('the test command names the package it runs in', () => {
		const { root, nested } = plans();

		expect(commandPackage(root.testCommand, ['.', 'apps/x'])).toBe('.');
		expect(commandPackage(nested.testCommand, ['.', 'apps/x'])).toBe('apps/x');
	});
});
