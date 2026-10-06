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
	expect(context?.reviewers[0].supplied).toEqual([{ kind: 'diff', path: 'src/a.ts', startLine: 1, endLine: 1 }]);
	expect(context?.findings.map((finding) => finding.via)).toEqual(['supplied']);
	expect(runs[1]?.reviewers).toEqual(context?.reviewers);
	expect(runs[1]?.findings.map((finding) => finding.via)).toEqual(['supplied']);
});

test('a checkpoint keeps the reads of finished assignments, and a resumed review carries them on', async () => {
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

	const first = (saved as ReviewProgressCheckpoint | null)?.reads?.byAssignment ?? {};

	expect(first['unit-1/correctness']?.[0]).toMatchObject({ action: 'readDiff', path: 'src/a.ts', ok: true });
	expect(first['unit-2/correctness']).toBeUndefined();

	stubModel([]);

	let resumed: ReviewProgressCheckpoint | null = null;

	await runAdaptiveReview(
		{ diff: TWO_UNIT_DIFF, sandboxPath: null, resume: saved },
		{
			onCheckpoint: (checkpoint) => {
				resumed = checkpoint;
			}
		}
	);

	const after = (resumed as ReviewProgressCheckpoint | null)?.reads?.byAssignment ?? {};

	expect(after['unit-1/correctness']).toEqual(first['unit-1/correctness']);
	expect(after['unit-2/correctness']?.[0]).toMatchObject({ action: 'readDiff', path: 'tests/b.ts', ok: true });
});
