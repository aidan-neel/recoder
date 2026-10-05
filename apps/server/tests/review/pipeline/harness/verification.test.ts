import { expect, test } from 'bun:test';
import type { DetectorResult } from '../../../../src/review/pipeline/detectors/types';
import type { ReviewRun } from '../../../../src/review/pipeline/harness/context';
import { addDetections } from '../../../../src/review/pipeline/harness/verification';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { addedFile } from '../harness-fixtures';

const DEAD: DetectorResult = {
	detector: 'dead-code',
	category: 'dead-code',
	title: '`orphan` is exported but never used',
	body: 'Nothing refers to it.',
	file: 'src/a.ts',
	line: 3,
	evidence: 'No reference outside src/a.ts.'
};

test('a resumed review does not add a detector finding it already holds', () => {
	const queued: string[] = [];

	const run = {
		inventory: buildInventory(addedFile('src/a.ts', 20), []),
		evidence: null,
		changeModel: null,
		ledger: null,
		candidates: [],
		nextCandidate: 1,
		verifying: { add: (candidate: { candidateId: string }) => queued.push(candidate.candidateId) }
	} as unknown as ReviewRun;

	addDetections(run, [DEAD]);
	addDetections(run, [DEAD, { ...DEAD, line: 9, title: '`other` is exported but never used' }]);

	expect(run.candidates.map((candidate) => [candidate.candidateId, candidate.line, candidate.valid])).toEqual([
		['c1', 3, true],
		['c2', 9, true]
	]);

	expect(queued).toEqual(['c1', 'c2']);
	expect(run.nextCandidate).toBe(3);
});
