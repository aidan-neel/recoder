import { expect, test } from 'bun:test';
import { applyProgressMessage, emptyReviewProgress } from '../src';
import type { DiffGuide } from '../src/diff-guide';

test('a live guide replaces the progress guide and remains available on reconnect', () => {
	const guide: DiffGuide = { source: 'deterministic', groups: [] };

	const progress = applyProgressMessage(emptyReviewProgress('review'), {
		type: 'step',
		sequence: 1,
		data: { diffGuide: guide }
	});

	expect(progress.diffGuide).toEqual(guide);

	expect(
		applyProgressMessage(emptyReviewProgress('review'), { type: 'snapshot', snapshot: progress }).diffGuide
	).toEqual(guide);
});
