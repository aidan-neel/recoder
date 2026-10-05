import { expect, test } from 'bun:test';
import {
	appearanceCounts,
	everyRunShare,
	meanPairwiseJaccard,
	meanStability,
	stabilityMetrics,
	type EvalFinding
} from '../../src/eval/metrics';

const runs = (...keys: string[][]) => keys.map((run) => new Set(run));

function finding(overrides: Partial<EvalFinding>): EvalFinding {
	return { file: 'src/a.ts', line: 1, category: 'correctness', severity: 'error', message: '', ...overrides };
}

test('a finding reported twice in one run counts once for that run', () => {
	const metrics = stabilityMetrics([[finding({ fingerprint: 'f1' }), finding({ fingerprint: 'f1', line: 9 })], []]);

	expect(metrics.findings).toHaveLength(1);
	expect(metrics.findings[0].appearances).toBe(1);
	expect(metrics.strict.meanStability).toBe(0.5);
});

test('mean stability averages each key’s share of runs over the union', () => {
	const counts = appearanceCounts(runs(['a', 'b'], ['a'], ['a', 'c']));

	expect(meanStability(counts, 3)).toBeCloseTo((3 / 3 + 1 / 3 + 1 / 3) / 3);
});

test('runs that all find nothing are perfectly stable', () => {
	const counts = appearanceCounts(runs([], [], []));

	expect(meanStability(counts, 3)).toBe(1);
	expect(everyRunShare(counts, 3)).toBe(1);
	expect(meanPairwiseJaccard(runs([], [], []))).toBe(1);
});

test('the every-run share counts only keys found in all runs', () => {
	const counts = appearanceCounts(runs(['a', 'b'], ['a', 'c'], ['a', 'b']));

	expect(everyRunShare(counts, 3)).toBeCloseTo(1 / 3);
});

test('mean pairwise Jaccard averages intersection over union across every pair', () => {
	const jaccard = meanPairwiseJaccard(runs(['a', 'b'], ['a'], ['c']));

	expect(jaccard).toBeCloseTo((1 / 2 + 0 + 0) / 3);
});

test('a single run has nothing to disagree with', () => {
	expect(meanPairwiseJaccard(runs(['a']))).toBe(1);
});

test('the loose key matches a finding whose fingerprint drifted', () => {
	const metrics = stabilityMetrics([
		[finding({ fingerprint: 'f1', symbol: 'save' })],
		[finding({ fingerprint: 'f2', symbol: 'save', line: 4 })]
	]);

	expect(metrics.strict.meanJaccard).toBe(0);
	expect(metrics.loose.meanJaccard).toBe(1);
});

test('findings without a fingerprint are counted per run and keyed by location', () => {
	const metrics = stabilityMetrics([[finding({})], [finding({}), finding({ fingerprint: 'f1' })]]);

	expect(metrics.perRun.map((run) => run.unfingerprinted)).toEqual([1, 1]);
	expect(metrics.findings[0]).toMatchObject({ key: 'unfingerprinted:src/a.ts:1:correctness', appearances: 2 });
});
