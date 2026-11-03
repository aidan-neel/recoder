import { beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdaptiveReview, type ReviewProgressCheckpoint } from '../../../../src/review/pipeline/harness';
import { DIFF, TWO_REVIEWERS, TWO_UNIT_DIFF, restoreAfterEach, stubModel, useTestModel } from '../harness-fixtures';

restoreAfterEach();

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-context-'));
});

/** The last checkpoint of a two-reviewer review whose second reviewer fails, so only the first finished. */
async function checkpointWithReviewerOneDone(): Promise<ReviewProgressCheckpoint | null> {
	useTestModel();
	stubModel([], 'reviewer-2');

	let saved: ReviewProgressCheckpoint | null = null;

	await runAdaptiveReview(
		{ diff: TWO_UNIT_DIFF, sandboxPath: null },
		{
			onCheckpoint: (checkpoint) => {
				saved = checkpoint;
			}
		}
	);

	return saved;
}

/** Finding ids are random per run, so the repeat compares the reviewers' records and how each finding's evidence arrived. */
test('a review records what each reviewer received, the same way every time', async () => {
	useTestModel();

	const runs = [];

	for (let index = 0; index < 2; index++) {
		stubModel([]);
		runs.push((await runAdaptiveReview({ diff: DIFF, sandboxPath: null })).context);
	}

	const [context] = runs;

	expect(context?.reviewers.map((reviewer) => reviewer.assignmentId)).toEqual(['reviewer-1']);

	expect(context?.units).toEqual({
		'reviewer-1': { supplied: [{ kind: 'diff', path: 'src/a.ts', startLine: 1, endLine: 1 }], omitted: [] }
	});

	expect(runs[1]?.reviewers).toEqual(context?.reviewers);

	for (const run of runs) {
		expect(run?.findings.map(({ cited, readBy }) => ({ cited, readBy }))).toEqual([
			{ cited: { supplied: 1, read: 0, unknown: 0 }, readBy: 0 }
		]);
	}
});

test('a checkpoint keeps the prompts and reads of finished assignments, and a resume records the prompt it kept', async () => {
	const saved = await checkpointWithReviewerOneDone();

	const received = saved?.received;
	const first = received?.byAssignment ?? {};

	expect(first['reviewer-1']?.[0]).toMatchObject({ action: 'readDiff', path: 'src/a.ts', ok: true });
	expect(first['reviewer-2']).toBeUndefined();
	expect(received?.prompts['reviewer-2']).toBeUndefined();

	/** A marker only the kept prompts hold, so the resumed record shows it read them instead of rebuilding. */
	const marker = { kind: 'sibling' as const, path: 'src/kept.ts', startLine: 1, endLine: 2 };

	received?.prompts['reviewer-1']?.context.supplied.push(marker);

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

	expect(after['reviewer-1']).toEqual(first['reviewer-1']);
	expect(result.context?.units['reviewer-1'].supplied).toContainEqual(marker);
	expect(result.context?.units['reviewer-2'].supplied).not.toContainEqual(marker);
	expect(after['reviewer-2']?.[0]).toMatchObject({ action: 'readDiff', path: 'tests/b.ts', ok: true });
});

test('a two-reviewer review stores each reviewer’s prompt once, and each reviewer points at its own', async () => {
	useTestModel();
	stubModel([]);

	const context = (await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null })).context;

	expect(Object.keys(context?.units ?? {})).toEqual(TWO_REVIEWERS);

	expect(context?.reviewers.map((reviewer) => [reviewer.assignmentId, reviewer.unit])).toEqual(
		TWO_REVIEWERS.map((id) => [id, id])
	);

	expect(context?.reviewers.every((reviewer) => !('supplied' in reviewer))).toBe(true);

	expect(context?.units['reviewer-2'].supplied).toEqual([
		{ kind: 'diff', path: 'tests/b.ts', startLine: 1, endLine: 140 }
	]);
});

test('a review whose context record throws still completes, without the record', async () => {
	const saved = await checkpointWithReviewerOneDone();

	const received = saved?.received;

	/** A kept prompt with no record in it, so measuring the resumed review throws. */
	Object.assign(received?.prompts['reviewer-1'] ?? {}, { context: null });

	stubModel([]);

	const warn = spyOn(console, 'warn').mockImplementation(() => {});
	const result = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, resume: saved });

	const warned = warn.mock.calls.flat().join(' ');

	warn.mockRestore();

	expect(result.error).toBeUndefined();
	expect(result.outcome).toBe('complete');
	expect(result.context).toBeUndefined();
	expect(warned).toContain('context record skipped');
});
