import { expect, spyOn, test } from 'bun:test';
import { chatCompletion } from '../../../src/models/llm';
import { acquireLlmSlot, releaseLlmSlot } from '../../../src/models/llm/limiter';
import { lockedModels, runLocked, type LockedModels } from '../../../src/models/llm/locked-models';
import { withReviewMetrics } from '../../../src/models/metrics';
import { configForOrchestrator, configForSubagent, withLockedModels } from '../../../src/models/models';
import { saveReviewSettings } from '../../../src/review/session/review-settings';
import { db, reviewMetrics } from '../../../src/store';
import { FIRST, pickModels, resetAfterEach, SECOND, storedRuns } from '../../helpers/fake-reviewer';
import { testReview } from '../../helpers/review';

const realFetch = globalThis.fetch;
const cleanups = resetAfterEach();

/** A stored review the metrics count toward, removed after the test. */
function storedReview(): string {
	const review = testReview({ repoId: 'missing-repo', headSha: 'head' });

	db.reviews.set(review);

	cleanups.push(() => {
		db.reviews.delete(review.id);
		reviewMetrics.delete(review.id);
	});

	return review.id;
}

/** A model config named `model`, for picks set by hand. */
function picks(models: string[]): LockedModels {
	const config = (model: string) => ({ baseUrl: 'http://locked-models.test/v1', apiKey: '', model });

	return { orchestrator: config(models[0]!), subagent: config(models[1]!) };
}

test('the lock holds across the limiter queue, timers and awaits, whoever frees the slot', async () => {
	pickModels([...FIRST, ...SECOND]);
	process.env.RECODER_LLM_CONCURRENCY = '1';

	const endpoint = 'http://locked-models.test/v1';

	await acquireLlmSlot(endpoint);

	const queued = withLockedModels(async () => {
		await acquireLlmSlot(endpoint);
		await Bun.sleep(1);

		const timed = await new Promise<string>((resolve) => setTimeout(() => resolve(configForSubagent().model), 1));

		releaseLlmSlot(endpoint);

		return [configForOrchestrator().model, timed];
	});

	saveReviewSettings({ orchestratorModelId: SECOND[0], specialistModelId: SECOND[1] });
	runLocked(picks(['other-lead', 'other-worker']), () => releaseLlmSlot(endpoint));

	expect(await queued).toEqual(FIRST);
});

test('a Bun.serve handler runs in the context that created the server, not the requester’s', async () => {
	const server = runLocked(picks(FIRST), () =>
		Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response(lockedModels()?.orchestrator.model) })
	);

	try {
		const seen = await runLocked(picks(SECOND), () => realFetch(server.url).then((response) => response.text()));

		expect(seen).toBe(FIRST[0]!);
	} finally {
		await server.stop(true);
	}
});

test('a pipeline that runs without locked models records each miss and warns once', async () => {
	const reviewId = storedReview();
	const warn = spyOn(console, 'warn').mockImplementation(() => {});

	pickModels([...FIRST, ...SECOND]);

	globalThis.fetch = (async (_url, _init) =>
		Response.json({ choices: [{ message: { content: 'ok' } }], usage: { completion_tokens: 1 } })) as typeof fetch;

	try {
		await withReviewMetrics(reviewId, 'pipeline', () =>
			chatCompletion({ ...configForOrchestrator(), messages: [{ role: 'user', content: 'hi' }] }).then(() =>
				configForSubagent()
			)
		);

		const { runs, calls } = storedRuns(reviewId);

		expect(runs?.map(({ startedAt: _, ...run }) => run)).toEqual([
			{ index: 0, orchestrator: null, subagent: null, lockMisses: 2 }
		]);

		expect(calls.map((call) => [call.model, call.run, call.lockMiss])).toEqual([[FIRST[0], 0, true]]);
		expect(warn).toHaveBeenCalledTimes(1);
	} finally {
		warn.mockRestore();
	}
});

test('outside a pipeline the live pick is used, with no run and no miss recorded', async () => {
	const reviewId = storedReview();
	const warn = spyOn(console, 'warn').mockImplementation(() => {});

	pickModels([...FIRST, ...SECOND]);

	try {
		const before = withReviewMetrics(reviewId, 'discussion', () => configForOrchestrator().model);

		saveReviewSettings({ orchestratorModelId: SECOND[0], specialistModelId: SECOND[1] });

		const after = await withReviewMetrics(reviewId, 'fix', async () => {
			await Bun.sleep(1);

			return [configForOrchestrator().model, configForSubagent().model];
		});

		expect([before, ...after, configForOrchestrator().model]).toEqual([FIRST[0], ...SECOND, SECOND[0]]);
		expect(storedRuns(reviewId).runs).toBeUndefined();
		expect(warn).not.toHaveBeenCalled();
	} finally {
		warn.mockRestore();
	}
});
