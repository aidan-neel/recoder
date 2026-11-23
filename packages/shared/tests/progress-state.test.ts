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

test('a candidate is raised, checked and settled in place, and survives a reconnect', () => {
	const raised = {
		id: 'c1',
		title: '429 responses carry no Retry-After header',
		path: 'src/api/headers.ts',
		line: 18,
		tier: 'bug' as const,
		raisedBy: 'reviewer-1',
		raisedAt: '2026-11-23T00:00:17Z',
		state: 'raised' as const
	};

	let progress = applyProgressMessage(emptyReviewProgress('review'), {
		type: 'candidate',
		sequence: 1,
		data: { candidate: raised }
	});

	progress = applyProgressMessage(progress, {
		type: 'candidate',
		sequence: 2,
		data: { candidate: { ...raised, state: 'proven', verifierId: 'verifier-2', message: 'Traced through the code' } }
	});

	expect(progress.candidates).toEqual([
		{ ...raised, state: 'proven', verifierId: 'verifier-2', message: 'Traced through the code' }
	]);

	expect(progress.activity).toEqual([]);

	expect(
		applyProgressMessage(emptyReviewProgress('review'), { type: 'snapshot', snapshot: progress }).candidates
	).toEqual(progress.candidates);
});
