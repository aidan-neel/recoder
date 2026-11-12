import { describe, expect, test } from 'bun:test';
import type { SettledRun } from '../../../../src/sandbox/exec-workspace';
import type { DetectorResult } from '../../../../src/review/pipeline/detectors/types';
import { testMatrix } from '../../../../src/review/pipeline/mutation/matrix';
import { singleFileCommands, type CommandPlan } from '../../../../src/review/pipeline/mutation/test-run';

const done = (exitCode: number): SettledRun => ({
	exitCode,
	output: '',
	truncated: false,
	timedOut: false,
	elapsedMs: 1
});

/** The text a plan's scratch files carry: the mutated or probe file's content. */
const payloadOf = (plan: CommandPlan) => plan.files.map((file) => file.text).join('');

/** Whether the plan writes `path` through the cat step. */
const writesTo = (plan: CommandPlan, path: string) => plan.command.includes(`> ${path}`);

/** Whether the plan carries the old test copy. */
const hasOldTest = (plan: CommandPlan) => plan.files.some((file) => file.path.includes('recoder-old'));

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
	closed: () => false,
	deadline: Date.now() + 60_000
};

/** Fails the old test only on a mutated source, like a suite whose edit dropped the check. */
function runner(oldFailsOnMutant: boolean) {
	return async (plan: CommandPlan): Promise<SettledRun> => {
		const mutated = writesTo(plan, 'src/a.ts');
		const old = hasOldTest(plan);

		return done(mutated && old && oldFailsOnMutant ? 1 : 0);
	};
}

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
			run: async (plan) => done(hasOldTest(plan) ? 1 : 0)
		});

		expect(outcome.results).toEqual([]);
	});

	test('counts a timed-out run as no evidence, neither kill nor survivor', async () => {
		const outcome = await testMatrix({
			...input,
			run: async (plan) => (writesTo(plan, 'src/a.ts') ? { ...done(0), timedOut: true } : done(0))
		});

		expect(outcome.results).toEqual([]);
		expect(outcome.counts.mutants).toBeGreaterThan(0);
		expect(outcome.counts.killed).toBe(0);
		expect(outcome.counts.survivors).toBe(0);
	});

	test('counts a run that never produced an exit code as no evidence', async () => {
		const outcome = await testMatrix({
			...input,
			run: async (plan) => (writesTo(plan, 'src/a.ts') ? { ...done(0), exitCode: null } : done(0))
		});

		expect(outcome.results).toEqual([]);
		expect(outcome.counts.killed).toBe(0);
		expect(outcome.counts.survivors).toBe(0);
	});

	test('runs the sources in the order the test file imports them', async () => {
		const targets: string[] = [];

		const order = {
			tests: [
				{
					path: 'src/t.test.ts',
					base: 'old',
					head: "import x from './zXz';\nconst t = 1;",
					added: new Set([2]),
					visible: new Set([1, 2])
				}
			],
			sources: new Map([
				['src/a.ts', 'export const a = 1 >= 0 ? 1 : 0;'],
				['src/z.z.ts', 'export const z = 2 >= 0 ? 1 : 0;']
			]),
			added: new Map([
				['src/a.ts', new Map([[1, '']])],
				['src/z.z.ts', new Map([[1, '']])]
			]),
			suspicions: [] as DetectorResult[],
			commandFor: singleFileCommands(['.: test → bun test'], []),
			closed: () => false,
			deadline: Date.now() + 60_000,
			run: async (plan: CommandPlan): Promise<SettledRun> => {
				const target = /> ([\w./@-]+\.ts)/.exec(plan.command)?.[1];

				if (target) targets.push(target);

				return done(0);
			}
		};

		await testMatrix(order);

		expect(targets).toEqual([
			'src/a.ts',
			'src/a.ts',
			'src/a.ts',
			'src/a.ts',
			'src/z.z.ts',
			'src/z.z.ts',
			'src/z.z.ts',
			'src/z.z.ts'
		]);
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
	closed: () => false,
	deadline: Date.now() + 60_000
};

/** Passes on correct code and on a mutant unless `kills` says otherwise; a probe fails only when `reaches`. */
function detectedRunner(opts: { kills?: boolean; reaches?: boolean }) {
	return async (plan: CommandPlan): Promise<SettledRun> => {
		if (writesTo(plan, 'src/b.ts')) {
			if (payloadOf(plan).includes('recoder-probe'))
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

	test('gives no finding and names the reason when the probe run never finishes', async () => {
		const outcome = await testMatrix({
			...detected,
			run: async (plan) =>
				writesTo(plan, 'src/b.ts') && payloadOf(plan).includes('recoder-probe')
					? { ...done(1), timedOut: true }
					: detectedRunner({})(plan)
		});

		expect(outcome.results).toEqual([]);
		expect(outcome.counts.skips['probe-broke']).toBe(1);
		expect(outcome.counts.survivorRows).toHaveLength(1);
	});

	test('gives no finding when the probe fails for another reason', async () => {
		const outcome = await testMatrix({
			...detected,
			run: async (plan) =>
				writesTo(plan, 'src/b.ts') && payloadOf(plan).includes('recoder-probe')
					? { ...done(1), output: 'unrelated failure' }
					: detectedRunner({})(plan)
		});

		expect(outcome.results).toEqual([]);
		expect(outcome.counts.skips['probe-broke']).toBe(1);
	});

	test('does not count a run the profile says never reached an assertion as a kill', async () => {
		const outcome = await testMatrix({
			...detected,
			run: async (plan): Promise<SettledRun> => (plan.files.length ? { ...done(1), outcome: 'setup-failed' } : done(0))
		});

		expect(outcome.results).toEqual([]);
		expect(outcome.counts.killed).toBe(0);
		expect(outcome.counts.skips['setup-failed']).toBe(1);
	});

	test('counts a run the profile says failed an assertion as a kill', async () => {
		const outcome = await testMatrix({
			...detected,
			run: async (plan): Promise<SettledRun> =>
				plan.files.length ? { ...done(1), outcome: 'assertion-failed' } : done(0)
		});

		expect(outcome.results).toEqual([]);
		expect(outcome.counts.killed).toBe(1);
	});

	test('names the reason when the unmutated test fails', async () => {
		const outcome = await testMatrix({ ...detected, run: async () => ({ ...done(1), output: 'cannot find module' }) });

		expect(outcome.counts.skips['sanity-failed']).toBe(1);
		expect(outcome.counts.sanityOutput).toBe('cannot find module');
	});

	test('runs nothing once the review has closed', async () => {
		const outcome = await testMatrix({ ...detected, closed: () => true, run: detectedRunner({}) });

		expect(outcome.counts.runs).toBe(0);
		expect(outcome.results).toEqual([]);
	});

	test('stops queueing runs when the review closes mid-matrix', async () => {
		let calls = 0;
		const inner = detectedRunner({});

		const outcome = await testMatrix({
			...detected,
			closed: () => calls > 0,
			run: async (plan) => {
				calls++;

				return inner(plan);
			}
		});

		expect(outcome.counts.runs).toBe(1);
		expect(outcome.results).toEqual([]);
	});

	test('stops at the deadline', async () => {
		const outcome = await testMatrix({ ...detected, deadline: Date.now() - 1, run: detectedRunner({}) });

		expect(outcome.results).toEqual([]);
		expect(outcome.counts.skips.budget).toBe(1);
	});
});
