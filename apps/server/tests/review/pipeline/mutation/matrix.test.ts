import { describe, expect, test } from 'bun:test';
import type { RunResult } from '../../../../src/sandbox/exec-sandbox';
import { testMatrix } from '../../../../src/review/pipeline/mutation/matrix';
import { mutantCommand, oldCopyPath, singleFileCommands } from '../../../../src/review/pipeline/mutation/test-run';

const done = (exitCode: number): RunResult => ({
	exitCode,
	output: '',
	truncated: false,
	timedOut: false,
	elapsedMs: 1
});

const SOURCE = 'export function ok(n: number) {\n\treturn n >= 3;\n}';

const input = {
	tests: [
		{
			path: 'src/a.test.ts',
			base: 'old',
			head: 'new',
			added: new Set([2]),
			visible: new Set([1, 2])
		}
	],
	sources: new Map([['src/a.ts', SOURCE]]),
	added: new Map([['src/a.ts', new Map([[2, '']])]]),
	commandFor: singleFileCommands(['.: test → xo && ava'], ['pnpm run test']),
	deadline: Date.now() + 60_000
};

/** Fails the old test only on a mutated source, like a suite whose edit dropped the check. */
function runner(oldFailsOnMutant: boolean) {
	return async (command: string): Promise<RunResult> => {
		const mutated = command.includes('> src/a.ts');
		const old = command.includes('recoder-old');

		return done(mutated && old && oldFailsOnMutant ? 1 : 0);
	};
}

describe('single-file commands', () => {
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

	test('keeps the test marker on the old copy and cleans it up', () => {
		const path = oldCopyPath('src/a.test.ts');

		expect(path).toBe('src/a.recoder-old.test.ts');

		expect(mutantCommand({ source: null, oldTest: { path, text: 'x' }, run: 'pnpm run test' })).toContain(
			`rm -f -- ${path}`
		);
	});
});

describe('testMatrix', () => {
	test('reports a mutant the old test fails and the edited test passes', async () => {
		const outcome = await testMatrix({ ...input, run: runner(true) });

		expect(outcome.results).toHaveLength(1);
		expect(outcome.results[0]).toMatchObject({ detector: 'mutation', file: 'src/a.test.ts', category: 'tests' });
	});

	test('reports nothing when the old test passes on every mutant too', async () => {
		expect((await testMatrix({ ...input, run: runner(false) })).results).toEqual([]);
	});

	test('reports nothing when the old test already fails on the correct code', async () => {
		const outcome = await testMatrix({
			...input,
			run: async (command) => done(command.includes('recoder-old') ? 1 : 0)
		});

		expect(outcome.results).toEqual([]);
	});

	test('treats a timed-out run as no evidence', async () => {
		const outcome = await testMatrix({ ...input, run: async () => ({ ...done(0), timedOut: true }) });

		expect(outcome.results).toEqual([]);
	});
});
