import { expect, test } from 'bun:test';
import { defectStages, stageTotals, type PoolCandidate } from '../../src/eval/benchmark-stages';
import { defect, score } from '../helpers/benchmark';

function candidate(over: Partial<PoolCandidate>): PoolCandidate {
	return { file: 'src/a.ts', message: 'm', severity: 'info', stage: null, reason: null, verified: false, ...over };
}

test('a defect only a dropped candidate matches is found, not verified, and names the stage that stopped it', () => {
	const pool = [candidate({ stage: 'refuted', reason: 'refuted by the verifier: it is guarded' })];
	const stages = defectStages([defect], pool, { all: score({ d1: 0 }), verified: score({}), published: score({}) });

	expect(stages.d1).toEqual({
		found: true,
		verified: false,
		published: false,
		stoppedAt: 'refuted',
		reason: 'refuted by the verifier: it is guarded'
	});
});

test('a verified candidate held back below the bar counts as verified and stopped at severity', () => {
	const pool = [candidate({ stage: 'severity', reason: 'low severity is below the reporting bar', verified: true })];

	const stages = defectStages([defect], pool, {
		all: score({ d1: 0 }),
		verified: score({ d1: 0 }),
		published: score({})
	});

	expect(stages.d1).toMatchObject({ found: true, verified: true, published: false, stoppedAt: 'severity' });
});

test('a published defect counts as found and verified even when the judge matched no candidate to it', () => {
	const stages = defectStages([defect], [], { all: score({}), verified: score({}), published: score({ d1: 0 }) });

	expect(stages.d1).toEqual({ found: true, verified: true, published: true });
});

test('stage totals count each stage and what stopped the defects that fell short', () => {
	const stopped = { found: true, verified: false, published: false, stoppedAt: 'refuted' } as const;
	const shown = { found: true, verified: true, published: true };

	const totals = stageTotals([
		{ defects: [defect], stages: { d1: stopped } },
		{ defects: [defect], stages: { d1: shown } }
	]);

	expect(totals).toEqual({ planted: 2, found: 2, verified: 1, published: 1, stoppedAt: { refuted: 1 } });
});
