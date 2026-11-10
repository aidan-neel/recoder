import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdaptiveReview, type ReviewProgressCheckpoint } from '../../../src/review/pipeline/harness';
import type { LensId } from '../../../src/review/pipeline/lenses/types';
import { NOTHING, addedFile, modelReply, restoreAfterEach, useTestModel } from './harness-fixtures';

restoreAfterEach();

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-lenses-resume-'));
});

const DIFF = addedFile('src/a.ts', 5);

/** Model calls made since the last `answerNothing`. */
let calls = 0;

/** Answers every model call with an empty result, counting them. */
function answerNothing(): void {
	calls = 0;
	useTestModel();

	globalThis.fetch = (async () => {
		calls++;

		return modelReply({ message: 'ok', ...NOTHING, examinedHunks: ['src/a.ts:0,0:1,5'] });
	}) as unknown as typeof fetch;
}

/** The last checkpoint a finished review of `DIFF` saved, with the lenses it applied. */
async function savedUnder(lenses?: LensId[]): Promise<ReviewProgressCheckpoint> {
	let saved: ReviewProgressCheckpoint | undefined;

	answerNothing();

	await runAdaptiveReview(
		{ diff: DIFF, sandboxPath: null, lenses },
		{ onCheckpoint: (checkpoint) => (saved = checkpoint) }
	);

	if (!saved) throw new Error('the review saved no checkpoint');

	return saved;
}

test('a checkpoint records the lens selection it was saved under, and has no selection key when none was given', async () => {
	expect((await savedUnder(['security', 'correctness'])).selection).toEqual(['security', 'correctness']);
	expect('selection' in (await savedUnder())).toBe(false);
});

test('a review resumes under the same lens selection, in any order, and reruns nothing that finished', async () => {
	const saved = await savedUnder(['security', 'correctness']);

	answerNothing();

	const resumed = await runAdaptiveReview({
		diff: DIFF,
		sandboxPath: null,
		lenses: ['correctness', 'security'],
		resume: saved
	});

	expect(resumed.outcome).toBe('complete');
	expect(resumed.assignments.map((record) => record.status)).toEqual(['done']);
});

test('a review resumed with no selection continues as before when its checkpoint has none', async () => {
	const saved = await savedUnder();

	answerNothing();

	expect((await runAdaptiveReview({ diff: DIFF, sandboxPath: null, resume: saved })).outcome).toBe('complete');
});

test('a resume under a different lens selection is refused before any model call, naming both', async () => {
	const saved = await savedUnder(['correctness', 'security']);

	answerNothing();

	await expect(
		runAdaptiveReview({ diff: DIFF, sandboxPath: null, lenses: ['readability'], resume: saved })
	).rejects.toThrow('saved with correctness, security and cannot continue with readability');

	expect(calls).toBe(0);
});

test('a checkpoint saved with every lens is refused under a selection, and one saved under a selection with none', async () => {
	const everyLens = await savedUnder();
	const selected = await savedUnder(['correctness']);

	answerNothing();

	await expect(
		runAdaptiveReview({ diff: DIFF, sandboxPath: null, lenses: ['correctness'], resume: everyLens })
	).rejects.toThrow('saved with every lens and cannot continue with correctness');

	await expect(runAdaptiveReview({ diff: DIFF, sandboxPath: null, resume: selected })).rejects.toThrow(
		'saved with correctness and cannot continue with every lens'
	);

	expect(calls).toBe(0);
});
