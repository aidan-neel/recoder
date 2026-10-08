import { expect, test } from 'bun:test';
import type { ScoredRun } from '../../src/eval/benchmark-report';
import { mixedReviewer, runReviewer } from '../../src/eval/run-reviewer';
import type { StoredMetrics } from '../../src/models/metrics';

/** The models the report declares: orchestrator, then specialist. */
const DECLARED = ['muse', 'muse-mini'];

/**
 * A stored metrics row whose pipeline runs locked `locks` (orchestrator/specialist, or null when the run went
 * unlocked; none for a row older than recording runs), with one pipeline call per `[model, run]` and one chat call.
 */
function row(locks: (string | null)[] | null, calls: [string, number?][]): StoredMetrics {
	const runs = locks?.map((lock, index) => {
		const [orchestrator, subagent] = lock ? lock.split('/') : [null, null];

		return { index, startedAt: '2026-10-06T19:00:00.000Z', orchestrator, subagent, lockMisses: 0 };
	});

	const call = (model: string, scope: 'pipeline' | 'discussion', run?: number) => ({
		id: crypto.randomUUID(),
		model,
		provider: 'opencode' as const,
		scope,
		status: 'completed' as const,
		usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
		...(run === undefined ? {} : { run })
	});

	return {
		id: 'review',
		startedAt: '2026-10-06T19:00:00.000Z',
		pipelineTracked: true,
		...(runs ? { runs } : {}),
		calls: [...calls.map(([model, run]) => call(model, 'pipeline', run)), call('chat-model', 'discussion')]
	} as StoredMetrics;
}

const asRuns = (...reviewers: ReturnType<typeof runReviewer>[]) =>
	reviewers.map((reviewer) => ({ reviewer }) as ScoredRun);

test('a review that called a model outside its locked picks makes the report mixed; every clean review makes it false', () => {
	const clean = runReviewer(
		row(
			['muse/muse-mini'],
			[
				['muse', 0],
				['muse-mini', 0]
			]
		),
		DECLARED
	);

	const strayed = runReviewer(
		row(
			['muse/muse-mini'],
			[
				['muse', 0],
				['luna', 0]
			]
		),
		DECLARED
	);

	expect(clean).toEqual({
		orchestrator: { model: 'muse', effort: 'not recorded' },
		specialist: { model: 'muse-mini', effort: 'not recorded' },
		pipelineRuns: 1,
		lockMisses: 0,
		unlockedCalls: 0,
		calledModels: ['muse', 'muse-mini'],
		verdict: 'CLEAN',
		mixed: false,
		reasons: [],
		tokens: [
			{ stage: 'other', model: 'muse', calls: 1, input: 3, cached: 0, written: 0, output: 2 },
			{ stage: 'other', model: 'muse-mini', calls: 1, input: 3, cached: 0, written: 0, output: 2 }
		]
	});

	expect(strayed).toMatchObject({ calledModels: ['luna', 'muse'], verdict: 'MIXED', mixed: true });
	expect(strayed.reasons).toEqual(['run 0 called luna']);
	expect(mixedReviewer(asRuns(clean, strayed))).toBe(true);
	expect(mixedReviewer(asRuns(clean, clean))).toBe(false);
});

test('a row stored before pipeline runs were recorded leaves the picks not recorded but lists its called models and a verdict', () => {
	const old = runReviewer(row(null, [['muse'], ['muse'], ['luna']]), DECLARED);

	expect(old).toMatchObject({
		orchestrator: 'not recorded',
		specialist: 'not recorded',
		pipelineRuns: 0,
		calledModels: ['luna', 'muse'],
		verdict: 'MIXED',
		mixed: true,
		reasons: ['runs not recorded called luna']
	});

	expect(runReviewer(row(null, [['muse'], ['muse-mini']]), DECLARED)).toMatchObject({
		orchestrator: 'not recorded',
		calledModels: ['muse', 'muse-mini'],
		verdict: 'CLEAN',
		mixed: false
	});
});

test('picks locked on other models than the report declares are mixed even when every call used them', () => {
	const swapped = runReviewer(row(['muse-mini/muse'], [['muse', 0]]), DECLARED);

	expect(swapped).toMatchObject({ verdict: 'CLEAN', mixed: true });
	expect(swapped.reasons).toEqual(['locked muse-mini/muse, the report declares muse/muse-mini']);
});

test('a replay records the picks of its last pipeline run and is mixed when its runs locked different models', () => {
	const replayed = runReviewer(
		row(
			['muse/muse-mini', 'luna/luna'],
			[
				['muse', 0],
				['luna', 1]
			]
		),
		DECLARED
	);

	expect(replayed).toMatchObject({
		orchestrator: { model: 'luna' },
		pipelineRuns: 2,
		calledModels: ['luna', 'muse'],
		verdict: 'MIXED',
		mixed: true
	});
});

test('an unlocked run, a missing row and a report without reviewers are told apart', () => {
	expect(runReviewer(row([null], [['muse', 0]]), DECLARED)).toMatchObject({
		orchestrator: 'not recorded',
		specialist: 'not recorded',
		pipelineRuns: 1
	});

	const missing = runReviewer(null, DECLARED);

	expect(missing).toMatchObject({ orchestrator: 'not recorded', calledModels: [], verdict: 'MISSING', mixed: false });
	expect(mixedReviewer(asRuns(missing))).toBe(false);
	expect(mixedReviewer([{} as ScoredRun])).toBe('not recorded');
});
