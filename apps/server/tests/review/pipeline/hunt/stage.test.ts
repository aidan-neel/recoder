import { expect, test } from 'bun:test';
import type { CandidateFinding } from '../../../../src/review/pipeline/consolidate';
import { huntRounds } from '../../../../src/review/pipeline/hunt/config';
import { freshCandidates, huntUnits } from '../../../../src/review/pipeline/hunt/stage';
import type { ReviewUnit } from '../../../../src/review/pipeline/units';
import { restoreEnvAfterEach } from '../obligations/fixtures';

restoreEnvAfterEach(['RECODER_HUNT_ROUNDS']);

function unit(id: string, lens: ReviewUnit['lens'], path = 'src/a.ts'): ReviewUnit {
	return { id, title: id, reason: 'first pass', scope: [{ path, hunkIds: ['h1'] }], lens };
}

function candidate(assignmentId: string, line: number, valid = true, file = 'src/a.ts'): CandidateFinding {
	return { candidateId: `${assignmentId}@${line}`, assignmentId, file, line, valid, title: `bug at ${line}` } as never;
}

test('a hunt round gets one hunter per first-pass defect lens, briefed with every report on its files', () => {
	const units = [
		unit('unit-1/correctness', 'correctness'),
		unit('unit-1/readability', 'readability'),
		unit('retry-unit-1/security', 'security'),
		unit('unit-1/security/hunt-1', 'security'),
		unit('unit-2/security', 'security', 'src/b.ts')
	];

	const reports = [candidate('unit-1/correctness', 10, false), candidate('unit-2/security', 4, true, 'src/b.ts')];

	const hunters = huntUnits(units, reports, 2);

	expect(hunters.map((hunter) => hunter.id)).toEqual(['unit-1/correctness/hunt-2', 'unit-2/security/hunt-2']);
	expect(hunters[0].reason).toContain('- src/a.ts:10 bug at 10');
	expect(hunters[0].reason).not.toContain('src/b.ts');
});

test('a round is dry when its valid candidates all sit near an earlier report', () => {
	const earlier = [candidate('unit-1/correctness', 20), candidate('unit-1/correctness/hunt-1', 50, false)];

	expect(freshCandidates([...earlier, candidate('unit-1/security/hunt-2', 22)], 2)).toEqual([]);
	expect(freshCandidates([...earlier, candidate('unit-1/security/hunt-2', 52)], 2)).toEqual([]);
	expect(freshCandidates([...earlier, candidate('unit-1/security/hunt-2', 30, false)], 2)).toEqual([]);
	expect(freshCandidates([...earlier, candidate('unit-1/security/hunt-2', 30)], 2).map((c) => c.line)).toEqual([30]);
});

test('hunt rounds default to 2 and take any whole number held between 1 and 4', () => {
	const read = (value: string | undefined) => {
		if (value === undefined) delete process.env.RECODER_HUNT_ROUNDS;
		else process.env.RECODER_HUNT_ROUNDS = value;

		return huntRounds();
	};

	expect([undefined, 'two', '1.5', '0', '1', '3', '9'].map(read)).toEqual([2, 2, 2, 1, 1, 3, 4]);
});
