import { expect, test } from 'bun:test';
import {
	CHECKPOINT_VERSION,
	resumableCheckpoint,
	type ReviewCheckpoint
} from '../../../src/review/session/review-checkpoint';

const revision = { headSha: 'head', mergeBaseSha: 'base' };

test('a checkpoint saved before review units is discarded instead of resumed', () => {
	const plannerEra = {
		id: 'r1',
		...revision,
		plan: { assignments: [{ id: 'correctness-1', role: 'correctness' }] },
		followUpsDone: true,
		candidates: []
	} as unknown as ReviewCheckpoint;

	const old = resumableCheckpoint(plannerEra, revision);

	expect(old.checkpoint).toBeNull();
	expect(old.discarded).toContain('older Recoder');

	const current: ReviewCheckpoint = { ...plannerEra, version: CHECKPOINT_VERSION };

	expect(resumableCheckpoint(current, revision)).toEqual({ checkpoint: current, discarded: null });
});
