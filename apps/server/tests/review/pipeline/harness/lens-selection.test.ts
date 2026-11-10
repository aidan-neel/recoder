import { afterEach, expect, test } from 'bun:test';
import { createRun } from '../../../../src/review/pipeline/harness/context';
import { runDiagnostics } from '../../../../src/review/pipeline/detectors/detectors';
import { repairCandidate } from '../../../../src/review/pipeline/harness/repair';
import { diagnosticStage } from '../../../../src/review/pipeline/harness/quality-stage';
import { cutUnits } from '../../../../src/review/pipeline/harness/unit-stage';
import type { LensId } from '../../../../src/review/pipeline/lenses/types';
import { planSecondLook } from '../../../../src/review/pipeline/second-look/stage';
import { REPAIR_DIFF, candidateOf, reported } from '../candidate-repair-fixtures';
import { addedFile } from '../harness-fixtures';

const FLAGS = ['RECODER_RESIDUAL', 'RECODER_TEST_STRENGTH'] as const;
const saved = Object.fromEntries(FLAGS.map((name) => [name, process.env[name]]));

afterEach(() => {
	for (const name of FLAGS) {
		if (saved[name] === undefined) delete process.env[name];
		else process.env[name] = saved[name];
	}
});

/** A run over a changed `src/a.ts` that applies `lenses`, with its reviewers cut. */
function cutRun(lenses: LensId[]) {
	const run = createRun({ diff: addedFile('src/a.ts', 5), sandboxPath: null, lenses });

	cutUnits(run);

	return run;
}

test('a candidate in a category the selected lenses do not report is not repaired, and costs no repair', async () => {
	const run = createRun({ diff: REPAIR_DIFF, sandboxPath: null, lenses: ['security'] });
	const candidate = candidateOf(reported({ line: 31 }));

	expect(await repairCandidate(run, candidate)).toBe(false);
	expect(candidate.repair).toBeUndefined();
	expect(run.repairs).toBe(0);
});

test('a candidate in a category the selected lenses report is repaired as before', async () => {
	const run = createRun({ diff: REPAIR_DIFF, sandboxPath: null, lenses: ['correctness'] });
	const candidate = candidateOf(reported());

	expect(await repairCandidate(run, candidate)).toBe(true);
	expect(run.repairs).toBe(1);
});

test('a type error is a detection only when a selected lens reports correctness', () => {
	const baseline = [
		{
			command: 'bunx tsc --noEmit',
			exitCode: 1,
			output: "src/a.ts(3,7): error TS2322: Type 'number' is not assignable to type 'string'."
		}
	];

	const readability = createRun({ diff: addedFile('src/a.ts', 5), sandboxPath: null, lenses: ['readability'] });
	const correctness = createRun({ diff: addedFile('src/a.ts', 5), sandboxPath: null, lenses: ['correctness'] });

	readability.baseline = baseline;
	correctness.baseline = baseline;

	expect(runDiagnostics(readability)).toEqual([]);
	expect(runDiagnostics(correctness).map((result) => result.detector)).toEqual(['typecheck']);
});

test('the mutation matrix runs the repository tests only when a selected lens reports tests', async () => {
	process.env.RECODER_TEST_STRENGTH = '1';

	const ran = async (lenses: LensId[]) => {
		const tasks = new Set<string>();

		const run = createRun(
			{ diff: addedFile('src/a.ts', 5), sandboxPath: null, lenses },
			{ onTask: (task) => tasks.add(task.id) }
		);

		await diagnosticStage(run, () => false, Promise.resolve());

		return tasks.has('matrix');
	};

	expect(await ran(['readability'])).toBe(false);
	expect(await ran(['correctness'])).toBe(true);
});

test('a residual pass is sent only when a selected lens reports bugs', async () => {
	process.env.RECODER_RESIDUAL = '1';

	expect(await planSecondLook(cutRun(['readability', 'conventions']), 4)).toEqual([]);
	expect((await planSecondLook(cutRun(['security']), 4)).map((unit) => unit.id)).toEqual(['residual-1']);
});
