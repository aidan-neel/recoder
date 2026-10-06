import { afterEach, expect, test } from 'bun:test';
import { matchKey } from '../../src/eval/benchmark-labels';
import { matchLines } from '../../src/eval/benchmark-matches-report';
import { rescoredRecords, scoreRun, type Judge } from '../../src/eval/benchmark-scoring';
import type { PoolCandidate } from '../../src/eval/benchmark-stages';
import { claimHash } from '../../src/eval/claim';
import type { BenchmarkReport, ScoredRun } from '../../src/eval/benchmark-report';
import type { LabeledDefect } from '../../src/eval/benchmark-score';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

const defect: LabeledDefect = {
	id: 'd1',
	kind: 'bug',
	category: 'correctness',
	file: 'src/a.ts',
	line: 10,
	title: 'd1',
	description: '',
	fix: ''
};

const finding = { file: 'src/a.ts', line: 10, message: `rescore-${crypto.randomUUID()}`, severity: 'high' };

const run = {
	index: 1,
	reviewId: 'review-1',
	outcome: 'passed',
	headSha: 'abc',
	durationMs: 1,
	summary: null,
	findings: [finding],
	hidden: null,
	candidates: 1
} as unknown as ScoredRun;

const report = { prs: [{ id: 'pr-1', runs: [run] }] } as unknown as BenchmarkReport;

test('a rescore starts no review and asks the judge nothing again about findings it already scored', async () => {
	const requests: string[] = [];
	let judged = 0;

	globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
		requests.push(`${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`);

		return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
	}) as typeof fetch;

	const judge: Judge = {
		chat: async () => {
			judged++;

			return '{"matches":[{"defect":"d1","finding":0,"sameBehavior":true,"sameCause":true,"reason":"same"}]}';
		},
		model: { model: `judge-${crypto.randomUUID()}`, provider: 'test', effort: null }
	};

	const labels = [{ id: 'pr-1', defects: [defect] }];
	const first = await rescoredRecords(report, labels, judge, 'http://server', {});
	const calls = judged;
	const second = await rescoredRecords(report, labels, judge, 'http://server', {});

	expect(calls).toBeGreaterThan(0);
	expect(judged).toBe(calls);
	expect(second[0]![0]!.score).toEqual(first[0]![0]!.score);
	expect(requests.every((request) => request.startsWith('GET '))).toBe(true);
});

test('a human correction overrides the judge with its reason at every stage, needs no server, and shows in the report', async () => {
	globalThis.fetch = (async () => {
		throw new Error('the saved pool is read, not the server');
	}) as unknown as typeof fetch;

	const claim = { file: 'src/a.ts', line: 10, message: `nearby-${crypto.randomUUID()}`, severity: 'warning' as const };
	const pool: PoolCandidate[] = [{ ...claim, id: 'c1', stage: null, reason: null, verified: true }];
	const reason = 'it describes a slow render, not the wrong item';
	const adjudications = { [matchKey('pr-1', 'd1', claimHash(claim))]: { reports: false, reason } };

	const judge: Judge = {
		chat: async () => '{"matches":[{"defect":"d1","finding":0,"sameBehavior":true,"sameCause":true,"reason":"same"}]}',
		model: { model: `judge-${crypto.randomUUID()}`, provider: 'test', effort: null }
	};

	const label = { id: 'pr-1', defects: [defect] };

	const scored = await scoreRun(
		judge,
		label,
		{ ...run, findings: [claim], findingIds: ['c1'] },
		'http://server',
		adjudications,
		pool
	);

	const pr = { id: 'pr-1', defects: [defect], runs: [scored] } as unknown as BenchmarkReport['prs'][number];

	expect(scored.score?.found).toEqual({});
	expect(scored.score?.adjudicated).toEqual([{ defect: 'd1', finding: 0, reports: false, reason }]);
	expect(scored.stages?.d1).toMatchObject({ found: false, verified: false, published: false });
	expect(scored.stages?.d1?.matches?.published).toMatchObject({ by: 'adjudicated', reason });
	expect(matchLines([pr]).some((line) => line.includes(reason))).toBe(true);
});
