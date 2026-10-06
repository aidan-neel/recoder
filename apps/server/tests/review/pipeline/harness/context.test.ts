import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdaptiveReview, type ReviewProgressCheckpoint } from '../../../../src/review/pipeline/harness';
import { DIFF, TWO_UNIT_DIFF, lensIdsOf, restoreAfterEach, stubModel, useTestModel } from '../harness-fixtures';

restoreAfterEach();

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-context-'));
});

/** Finding ids are random per run, so the repeat compares the reviewers' records and how each finding's evidence arrived. */
test('a review records what each lens reviewer received, the same way every time', async () => {
	useTestModel();

	const runs = [];

	for (let index = 0; index < 2; index++) {
		stubModel([]);
		runs.push((await runAdaptiveReview({ diff: DIFF, sandboxPath: null })).context);
	}

	const [context] = runs;

	expect(context?.reviewers.map((reviewer) => reviewer.assignmentId)).toEqual(lensIdsOf('unit-1'));

	expect(context?.units).toEqual({
		'unit-1': { supplied: [{ kind: 'diff', path: 'src/a.ts', startLine: 1, endLine: 1 }], omitted: [] }
	});

	expect(runs[1]?.reviewers).toEqual(context?.reviewers);

	for (const run of runs) {
		expect(run?.findings.map(({ cited, readBy }) => ({ cited, readBy }))).toEqual([
			{ cited: { supplied: 1, read: 0, unknown: 0 }, readBy: 0 }
		]);
	}
});

test('a checkpoint keeps the prompts and reads of finished assignments, and a resume records the prompt it kept', async () => {
	useTestModel();
	stubModel([], 'unit-2/correctness');

	let saved: ReviewProgressCheckpoint | null = null;

	await runAdaptiveReview(
		{ diff: TWO_UNIT_DIFF, sandboxPath: null },
		{
			onCheckpoint: (checkpoint) => {
				saved = checkpoint;
			}
		}
	);

	const received = (saved as ReviewProgressCheckpoint | null)?.received;
	const first = received?.byAssignment ?? {};

	expect(first['unit-1/correctness']?.[0]).toMatchObject({ action: 'readDiff', path: 'src/a.ts', ok: true });
	expect(first['unit-2/correctness']).toBeUndefined();
	expect(received?.prompts['unit-2/correctness']).toBeUndefined();

	/** A marker only the kept prompts hold, so the resumed record shows it read them instead of rebuilding. */
	const marker = { kind: 'sibling' as const, path: 'src/kept.ts', startLine: 1, endLine: 2 };

	for (const id of lensIdsOf('unit-1')) received?.prompts[id]?.context.supplied.push(marker);

	stubModel([]);

	let resumed: ReviewProgressCheckpoint | null = null;

	const result = await runAdaptiveReview(
		{ diff: TWO_UNIT_DIFF, sandboxPath: null, resume: saved },
		{
			onCheckpoint: (checkpoint) => {
				resumed = checkpoint;
			}
		}
	);

	const after = (resumed as ReviewProgressCheckpoint | null)?.received?.byAssignment ?? {};

	expect(after['unit-1/correctness']).toEqual(first['unit-1/correctness']);
	expect(result.context?.units['unit-1'].supplied).toContainEqual(marker);
	expect(result.context?.units['unit-2'].supplied).not.toContainEqual(marker);
	expect(after['unit-2/correctness']?.[0]).toMatchObject({ action: 'readDiff', path: 'tests/b.ts', ok: true });
});

test('a two-unit review stores each unit prompt once, and every lens reviewer points at its own', async () => {
	useTestModel();
	stubModel([]);

	const context = (await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null })).context;
	const lenses = [...lensIdsOf('unit-1'), ...lensIdsOf('unit-2')];

	expect(Object.keys(context?.units ?? {})).toEqual(['unit-1', 'unit-2']);
	expect(lenses).toHaveLength(16);

	expect(context?.reviewers.map((reviewer) => [reviewer.assignmentId, reviewer.unit])).toEqual(
		lenses.map((id) => [id, id.split('/')[0]])
	);

	expect(context?.reviewers.every((reviewer) => !('supplied' in reviewer))).toBe(true);
	expect(context?.units['unit-2'].supplied).toEqual([{ kind: 'diff', path: 'tests/b.ts', startLine: 1, endLine: 140 }]);
});
