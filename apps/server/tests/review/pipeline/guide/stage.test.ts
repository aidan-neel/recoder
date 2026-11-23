import { beforeEach, expect, test } from 'bun:test';
import { db, modelCalls } from '../../../../src/store';
import { getReviewMetrics, withUsageMetrics } from '../../../../src/models/metrics';
import { configForOrchestrator, withLockedModels } from '../../../../src/models/models';
import { guideInput, refineDiffGuide } from '../../../../src/review/pipeline/guide/stage';
import { runAdaptiveReview } from '../../../../src/review/pipeline/harness';
import { seedDiffGuide } from '../../../../src/review/pipeline/guide/seed';
import { settleOnClock, useFakeClock } from '../../../helpers/fake-clock';
import { testReview } from '../../../helpers/review';
import { isDiffGuide, modelReply, restoreAfterEach, useTestModel } from '../harness-fixtures';
import { added, newRun } from './fixtures';

restoreAfterEach();
useFakeClock();
beforeEach(() => useTestModel(4));

test('one brief-model request refines the guide without consuming the defect-review budget and records usage', async () => {
	const run = newRun();
	const seed = seedDiffGuide(run.inventory, null);
	const review = await db.reviews.set(testReview());
	let calls = 0;
	let model = '';

	globalThis.fetch = (async (_url, init) => {
		calls++;
		model = JSON.parse(String(init?.body)).model;

		return Response.json({
			choices: [
				{
					message: {
						content: JSON.stringify({
							groups: [
								{
									title: 'Core',
									explanation: 'Start with the definition.',
									hunks: [{ id: seed.groups[0].hunks[0].id, explanation: 'Defines the answer.' }]
								}
							]
						})
					}
				}
			],
			usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 }
		});
	}) as typeof fetch;

	const guide = await withLockedModels(() =>
		withUsageMetrics(review.id, 'pipeline', () => refineDiffGuide(run, seed, run.controller.signal))
	);

	const usage = await getReviewMetrics(review.id);

	expect(calls).toBe(1);
	expect(model).toBe(configForOrchestrator().model);
	expect(guide.source).toBe('model');
	expect(guide.groups[0].hunks[0].explanation).toBe('Defines the answer.');
	expect(run.budget.used).toBe(0);
	expect(usage?.total.usage).toMatchObject({ inputTokens: 100, outputTokens: 30 });

	const recorded = (await modelCalls.list()).filter((call) => call.ownerId === review.id);

	expect(recorded).toHaveLength(1);
	expect(recorded[0]).toMatchObject({ stage: 'intent', purpose: 'diff-guide', outcome: 'ok' });
	expect(recorded[0].durationMs).toBeGreaterThanOrEqual(0);
});

test.each(['malformed', 'failed'] as const)(
	'a %s answer uses the unexplained seed with no second model request',
	async (kind) => {
		const run = newRun();
		const seed = seedDiffGuide(run.inventory, null);
		let calls = 0;

		globalThis.fetch = (async () => {
			calls++;

			return kind === 'failed' ? new Response('bad request', { status: 400 }) : modelReply({ wrong: true });
		}) as unknown as typeof fetch;

		expect(await refineDiffGuide(run, seed, run.controller.signal)).toBe(seed);
		expect(calls).toBe(1);
	}
);

test('pure renames and an empty diff make no model request', async () => {
	let calls = 0;

	globalThis.fetch = (async () => {
		calls++;

		return modelReply({});
	}) as unknown as typeof fetch;

	for (const diff of [
		'',
		'diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n'
	]) {
		const run = newRun(diff);
		const seed = seedDiffGuide(run.inventory, null);

		expect(await refineDiffGuide(run, seed, run.controller.signal)).toBe(seed);
	}

	expect(calls).toBe(0);
});

/** A pending endpoint that proves cancellation reaches the actual model request. */
function pendingEndpoint(entered: () => void): void {
	globalThis.fetch = ((_url, init) => {
		entered();

		return new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
		});
	}) as typeof fetch;
}

test('the bounded request times out to the full deterministic guide', async () => {
	const run = newRun();
	const seed = seedDiffGuide(run.inventory, null);
	let calls = 0;

	pendingEndpoint(() => calls++);

	const guide = await settleOnClock(refineDiffGuide(run, seed, run.controller.signal), 100, 16000);

	expect(guide).toBe(seed);
	expect(calls).toBe(1);
});

test('finishing a review cancels an unfinished guide and never publishes a late refinement', async () => {
	const run = newRun();
	const published: unknown[] = [];
	let aborted = false;
	let guideCalls = 0;

	globalThis.fetch = ((_url, init) => {
		if (!isDiffGuide(init))
			return Promise.resolve(
				modelReply({
					summary: 'Core changes.',
					findings: [],
					examinedHunks: [...run.inventory.hunksById.keys()],
					subagents: []
				})
			);

		guideCalls++;

		return new Promise<Response>((_resolve, reject) =>
			init?.signal?.addEventListener(
				'abort',
				() => {
					aborted = true;
					reject(new DOMException('Aborted', 'AbortError'));
				},
				{ once: true }
			)
		);
	}) as typeof fetch;

	const result = await settleOnClock(
		runAdaptiveReview(run.input, { onDiffGuide: (guide) => published.push(guide) }),
		100,
		2000
	);

	expect(result.diffGuide?.source).toBe('deterministic');
	expect(guideCalls).toBe(1);
	expect(aborted).toBe(true);
	expect(published).toHaveLength(1);
});

test('large patches are clipped to an individual hunk share without losing any hunk ids', () => {
	const code = Array.from({ length: 500 }, (_, index) => `const item${index} = ${index};`).join('\n');
	const run = newRun(Array.from({ length: 20 }, (_, index) => added(`src/file${index}.ts`, code)).join(''));
	const seed = seedDiffGuide(run.inventory, null);
	const input = JSON.parse(guideInput(run, seed)) as { hunks: { id: string; patch: string }[] }[];
	const hunks = input.flatMap((group) => group.hunks);

	expect(hunks).toHaveLength(20);
	expect(hunks.every((hunk) => hunk.patch.length > 0 && hunk.patch.length <= 3000)).toBe(true);
	expect(hunks.reduce((sum, hunk) => sum + hunk.patch.length, 0)).toBeLessThanOrEqual(60000);
});
