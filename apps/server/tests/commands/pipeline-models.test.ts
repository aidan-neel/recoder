import { expect, test } from 'bun:test';
import type { Repo } from '@recoder/shared';
import { createReviewSession, startReviewSession } from '../../src/commands/pipeline';
import { replayReviewSession } from '../../src/commands/rerun';
import type { PipelineRun, RunTokenCall } from '../../src/models/metrics';
import { saveReviewSettings } from '../../src/review/session/review-settings';
import { db, reviewMetrics } from '../../src/store';
import {
	fakeReviewer,
	FIRST,
	pickModels,
	resetAfterEach,
	reviewEnded,
	SECOND,
	storedRuns,
	type FakeRequest
} from '../helpers/fake-reviewer';
import { localForgeFixture } from '../helpers/local-forge';

const cleanups = resetAfterEach();

/** The local forge's repo with PR #7, removed after the test. */
async function forgeRepo(): Promise<Repo> {
	const { repo } = await localForgeFixture();

	db.repos.set(repo);
	cleanups.push(() => db.repos.delete(repo.id));

	return repo;
}

/** Starts a review of PR #7 and resolves with its id once it ends. */
async function reviewToEnd(repo: Repo): Promise<string> {
	const reviewId = createReviewSession({ repoId: repo.id, prNumber: 7 }).id;
	const done = reviewEnded(reviewId);

	cleanups.push(() => {
		db.reviews.delete(reviewId);
		reviewMetrics.delete(reviewId);
	});

	startReviewSession(reviewId);
	await done;

	return reviewId;
}

/** The models each pipeline run called, by the run index the call carries (`?` for none). */
function modelsByRun(calls: RunTokenCall[]): Record<string, string[]> {
	const byRun: Record<string, string[]> = {};

	for (const call of calls) {
		const key = `run ${call.run ?? '?'}`;

		byRun[key] = [...new Set([...(byRun[key] ?? []), call.model])].sort();
	}

	return byRun;
}

/** A run segment as the tests compare it, without its start time. */
function segment(index: number, models: string[]): Omit<PipelineRun, 'startedAt'> {
	return { index, orchestrator: models[0]!, subagent: models[1]!, lockMisses: 0 };
}

test('a review keeps the models it started on for every call when the pick changes mid-run', async () => {
	const repo = await forgeRepo();
	const requests: FakeRequest[] = [];

	process.env.RECODER_LLM_CONCURRENCY = '1';
	pickModels([...FIRST, ...SECOND]);

	globalThis.fetch = fakeReviewer(requests, (answered) => {
		if (answered === 0) saveReviewSettings({ orchestratorModelId: SECOND[0], specialistModelId: SECOND[1] });
	});

	const reviewId = await reviewToEnd(repo);
	const { runs, calls } = storedRuns(reviewId);

	expect(db.reviews.get(reviewId)?.status).toBe('passed');

	expect([...new Set(requests.map((request) => request.kind))].sort()).toEqual([
		'brief',
		'correctness',
		'lens',
		'subagent'
	]);

	expect(calls).toHaveLength(requests.length);
	expect([...new Set(requests.map((request) => request.model))].sort()).toEqual(FIRST);
	expect(modelsByRun(calls)).toEqual({ 'run 0': FIRST });
	expect(runs?.map(({ startedAt: _, ...run }) => run)).toEqual([segment(0, FIRST)]);
	expect(calls.filter((call) => call.lockMiss)).toEqual([]);
}, 60_000);

test('a replay under a new pick runs as its own run on the new models, apart from the first', async () => {
	const repo = await forgeRepo();
	const requests: FakeRequest[] = [];

	pickModels([...FIRST, ...SECOND]);
	globalThis.fetch = fakeReviewer(requests);

	const reviewId = await reviewToEnd(repo);
	const firstRun = requests.length;

	expect(db.reviews.get(reviewId)?.status).toBe('passed');
	saveReviewSettings({ orchestratorModelId: SECOND[0], specialistModelId: SECOND[1] });

	const replayed = reviewEnded(reviewId);

	replayReviewSession(reviewId, true);
	await replayed;

	const { runs, calls } = storedRuns(reviewId);
	const replayModels = [...new Set(requests.slice(firstRun).map((request) => request.model))].sort();

	expect(db.reviews.get(reviewId)?.status).toBe('passed');
	expect(replayModels.every((model) => SECOND.includes(model))).toBe(true);
	expect(modelsByRun(calls)).toEqual({ 'run 0': FIRST, 'run 1': replayModels });
	expect(runs?.map(({ startedAt: _, ...run }) => run)).toEqual([segment(0, FIRST), segment(1, SECOND)]);
}, 60_000);
