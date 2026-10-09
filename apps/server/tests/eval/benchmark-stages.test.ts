import { expect, test } from 'bun:test';
import { judgePr } from '../../src/eval/benchmark-judge';
import { defectStages, judgeStages, stageTotals, type PoolCandidate } from '../../src/eval/benchmark-stages';
import { claimHash } from '../../src/eval/claim';
import type { EvalFinding } from '../../src/eval/metrics';
import { defect, score } from '../helpers/benchmark';

function candidate(over: Partial<PoolCandidate>): PoolCandidate {
	return { file: 'src/a.ts', message: 'm', severity: 'info', stage: null, reason: null, verified: false, ...over };
}

const none = { all: score({}), verified: score({}) };

/** The claim the planted defect is about, and a claim on the same lines about another behavior. */
const wrongIndex = {
	file: 'src/a.ts',
	line: 10,
	message: 'reads the item at the index taken before filtering',
	severity: 'warning' as const
};

const slowRender = {
	file: 'src/a.ts',
	line: 10,
	message: 'recomputes the filtered list on every render',
	severity: 'warning' as const
};

/** A judge that credits only the wrong-index claim, and says why it rejects any other claim it weighs. */
function behaviorJudge(asked: string[][]) {
	return (findings: readonly EvalFinding[]) => {
		asked.push(findings.map((finding) => finding.message));

		const index = findings.findIndex((finding) => finding.message === wrongIndex.message);
		const weighed = index === -1 ? (findings.length ? 0 : null) : index;

		const reply = {
			matches: [
				{
					defect: 'd1',
					finding: weighed,
					behavior: index === -1 ? 'renders slowly' : 'returns the wrong item',
					cause: index === -1 ? 'no memoization' : 'index taken before filtering',
					sameBehavior: index !== -1,
					sameCause: index !== -1,
					reason: ''
				}
			]
		};

		return judgePr(async () => JSON.stringify(reply), [defect], findings);
	};
}

test('a defect only a dropped candidate matches is found, not verified, and names the stage that stopped it', () => {
	const pool = [candidate({ stage: 'refuted', reason: 'refuted by the verifier: it is guarded' })];
	const published = { findings: [], score: score({}) };
	const stages = defectStages([defect], pool, published, { ...none, all: score({ d1: 0 }) });

	expect(stages.d1).toMatchObject({
		found: true,
		verified: false,
		published: false,
		stoppedAt: 'refuted',
		reason: 'refuted by the verifier: it is guarded'
	});
});

test('a verified candidate held back below the bar counts as verified and stopped at severity', () => {
	const pool = [candidate({ stage: 'severity', reason: 'low severity is below the reporting bar', verified: true })];
	const published = { findings: [], score: score({}) };
	const stages = defectStages([defect], pool, published, { all: score({ d1: 0 }), verified: score({ d1: 0 }) });

	expect(stages.d1).toMatchObject({ found: true, verified: true, published: false, stoppedAt: 'severity' });
});

test('a published defect counts as found and verified even when no candidate carries its claim', () => {
	const published = { findings: [candidate({})], score: score({ d1: 0 }) };
	const stages = defectStages([defect], [], published, none);

	expect(stages.d1).toMatchObject({ found: true, verified: true, published: true });
	expect(stages.d1!.matches!.found.by).toBe('reused');
});

test('a published defect whose only carrying candidate is unverified counts as found and published, not verified', () => {
	const pool = [candidate(wrongIndex)];
	const published = { findings: [candidate(wrongIndex)], score: score({ d1: 0 }) };
	const stages = defectStages([defect], pool, published, none);

	expect(stages.d1).toMatchObject({ found: true, verified: false, published: true });
});

test('a candidate with the published claim word for word takes its verdict, so it is never a stage loss', async () => {
	const asked: string[][] = [];
	const pool = [candidate({ ...slowRender, verified: true })];
	const published = { findings: [candidate(slowRender)], ids: ['f1'], score: score({}) };

	const stages = await judgeStages([defect], pool, published, async (findings) => {
		asked.push(findings.map((finding) => finding.message));

		return score(findings.length ? { d1: 0 } : {});
	});

	expect(stages.d1).toMatchObject({ found: false, verified: false, published: false });
	expect(stages.d1!.stoppedAt).toBeUndefined();
	expect(asked).toEqual([[]]);
});

test('a credited published claim is reused for the candidate that carries it, without judging it again', async () => {
	const asked: string[][] = [];
	const pool = [candidate({ ...wrongIndex, id: 'c1', verified: true })];
	const published = { findings: [candidate(wrongIndex)], ids: ['c1'], score: score({ d1: 0 }) };
	const stages = await judgeStages([defect], pool, published, behaviorJudge(asked));

	expect(asked).toEqual([[]]);
	expect(stages.d1!.matches!.found).toMatchObject({ by: 'reused', claim: { id: 'c1', hash: claimHash(wrongIndex) } });
});

test("a nearby claim about another behavior on the defect's lines does not match it, and the evidence says why", async () => {
	const pool = [candidate({ ...slowRender, id: 'c1', verified: true })];
	const published = { findings: [], ids: [], score: score({}) };
	const stages = await judgeStages([defect], pool, published, behaviorJudge([]));

	expect(stages.d1).toMatchObject({ found: false, verified: false, published: false });

	expect(stages.d1!.matches!.found).toMatchObject({
		claim: null,
		behavior: 'renders slowly',
		rejected: { id: 'c1', hash: claimHash(slowRender) }
	});
});

test('a claim merged into a published finding whose text no longer reports the defect stays a consolidation loss', async () => {
	const pool = [
		candidate({ ...wrongIndex, id: 'c1', verified: true }),
		candidate({ ...slowRender, id: 'c2', verified: true })
	];

	const merged = { ...candidate(slowRender), memberIds: ['c1', 'c2'] };
	const published = { findings: [merged], ids: ['c2'], score: score({}) };
	const stages = await judgeStages([defect], pool, published, behaviorJudge([]));

	expect(stages.d1).toMatchObject({
		found: true,
		verified: true,
		published: false,
		stoppedAt: 'consolidation',
		lost: { claim: { id: 'c1', hash: claimHash(wrongIndex) }, change: 'changed', into: 'c2' }
	});
});

test('a claim only the verified call credits is the found evidence too, so the stages never disagree on it', () => {
	const pool = [candidate({ ...wrongIndex, id: 'c1', verified: true })];
	const published = { findings: [], ids: [], score: score({}) };
	const stages = defectStages([defect], pool, published, { all: score({}), verified: score({ d1: 0 }) });
	const claim = { id: 'c1', hash: claimHash(wrongIndex) };

	expect(stages.d1).toMatchObject({ found: true, verified: true, stoppedAt: 'consolidation' });
	expect(stages.d1!.matches!.found.claim).toEqual(claim);
	expect(stages.d1!.matches!.verified.claim).toEqual(claim);
});

test('when every changed candidate is verified the judge is asked once, so found and verified cannot disagree', async () => {
	const asked: string[][] = [];
	const pool = [candidate({ ...wrongIndex, id: 'c1', verified: true })];
	const published = { findings: [], ids: [], score: score({}) };
	const stages = await judgeStages([defect], pool, published, behaviorJudge(asked));

	expect(asked).toEqual([[wrongIndex.message]]);
	expect(stages.d1).toMatchObject({ found: true, verified: true, stoppedAt: 'consolidation' });
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
