import { describe, expect, test } from 'bun:test';
import type { RunResult } from '../../../../src/sandbox/exec-sandbox';
import type { DetectorResult } from '../../../../src/review/pipeline/detectors/types';
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
	suspicions: [] as DetectorResult[],
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

	test('follows a test script that only runs another script', () => {
		const scripts = ['docs: test → bun run test:ci', 'docs: test:ci → vitest run --project unit'];

		const commandFor = singleFileCommands(scripts, ['cd docs && bun run test']);

		expect(commandFor('docs/a.test.ts')).toBe(
			'cd docs && bunx vitest run --project unit --reporter=dot --coverage.enabled=false a.test.ts'
		);
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

const THROWER = [
	'export class Base extends Error {}',
	'export class Specific extends Base {}',
	'export function f(n: number) {',
	"\tif (n < 0) throw new Specific('negative');",
	'}'
].join('\n');

const WEAK_TEST = "it('rejects negatives', () => {\n\texpect(() => f(-1)).toThrow(Base);\n});";

const suspicion: DetectorResult = {
	detector: 'weak-new-tests',
	category: 'tests',
	title: '`rejects negatives` accepts any `Base`',
	body: 'The test accepts any Base.',
	file: 'src/b.test.ts',
	line: 2,
	evidence: 'PR head',
	suspected: true
};

const newTest = {
	path: 'src/b.test.ts',
	base: '',
	head: WEAK_TEST,
	added: new Set([1, 2, 3]),
	visible: new Set([1, 2, 3])
};

const detected = {
	tests: [newTest],
	suspicions: [suspicion],
	sources: new Map([['src/b.ts', THROWER]]),
	added: new Map([['src/b.ts', new Map([[4, '']])]]),
	commandFor: singleFileCommands(['.: test → bun test'], []),
	deadline: Date.now() + 60_000
};

/** Passes on correct code and on a mutant unless `kills` says otherwise; a probe fails only when `reaches`. */
function detectedRunner(opts: { kills?: boolean; reaches?: boolean }) {
	return async (command: string): Promise<RunResult> => {
		if (command.includes('> src/b.ts') && command.includes('recoder-probe') === false) {
			const probe = Buffer.from(command.split("printf %s '")[1]!.split("'")[0]!, 'base64').toString();

			if (probe.includes('recoder-probe'))
				return { ...done(opts.reaches === false ? 0 : 1), output: 'Error: recoder-probe' };

			return done(opts.kills ? 1 : 0);
		}

		return done(0);
	};
}

describe('testMatrix on a suspected new test', () => {
	test('proves a suspicion when an aimed mutant survives on a line the test reaches', async () => {
		const outcome = await testMatrix({ ...detected, run: detectedRunner({}) });

		expect(outcome.results).toHaveLength(1);
		expect(outcome.results[0]).toMatchObject({ detector: 'mutation', file: 'src/b.test.ts', line: 2 });
		expect(outcome.counts).toMatchObject({ suspicions: 1, sanityPassed: 1, probes: 1, findings: 1 });
	});

	test('gives no finding when the mutant is killed', async () => {
		const outcome = await testMatrix({ ...detected, run: detectedRunner({ kills: true }) });

		expect(outcome.results).toEqual([]);
		expect(outcome.counts.killed).toBeGreaterThan(0);
	});

	test('gives no finding when the probe shows the line is not reached', async () => {
		const outcome = await testMatrix({ ...detected, run: detectedRunner({ reaches: false }) });

		expect(outcome.results).toEqual([]);
		expect(outcome.counts.skips.unreached).toBe(1);
	});

	test('names the reason when the unmutated test fails', async () => {
		const outcome = await testMatrix({ ...detected, run: async () => ({ ...done(1), output: 'cannot find module' }) });

		expect(outcome.counts.skips['sanity-failed']).toBe(1);
		expect(outcome.counts.sanityOutput).toBe('cannot find module');
	});

	test('stops at the deadline', async () => {
		const outcome = await testMatrix({ ...detected, deadline: Date.now() - 1, run: runner(false) });

		expect(outcome.results).toEqual([]);
		expect(outcome.counts.skips.budget).toBe(1);
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
