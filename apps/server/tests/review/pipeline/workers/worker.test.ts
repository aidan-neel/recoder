import { expect, test } from 'bun:test';
import { EvidenceStore } from '../../../../src/evidence/evidence';
import { ModelBudget } from '../../../../src/review/pipeline/agent-loop';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { workerDelegate } from '../../../../src/review/pipeline/workers/worker';
import { REVIEW_POLICY } from '../../../../src/review/session/review-policy';
import { restoreAfterEach, useTwoModels } from '../harness-fixtures';

restoreAfterEach();

const diff = 'diff --git a/pool.ts b/pool.ts\n--- a/pool.ts\n+++ b/pool.ts\n@@ -1 +1 @@\n-old\n+new\n';

/** A worker host on a fresh store; the stub model reads the diff, then answers citing the record it got and one id no record has. */
function stubWorker() {
	const evidence = new EvidenceStore(null, buildInventory(diff), 12000);
	const models: string[] = [];
	let calls = 0;

	globalThis.fetch = (async (_url, init) => {
		const body = JSON.parse(init?.body as string);

		models.push(body.model);

		const content =
			calls++ % 2 === 0
				? { message: 'Reading.', actions: [{ action: 'readDiff', path: 'pool.ts' }] }
				: {
						message: 'Done.',
						answer: 'pool.ts:1 changed.',
						evidence: [...evidence.records.keys(), 'E999'],
						unresolved: null
					};

		return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
	}) as typeof fetch;

	const delegate = workerDelegate({
		evidence,
		budget: new ModelBudget(),
		signal: new AbortController().signal,
		deadlineAt: Date.now() + 600_000,
		exec: false,
		label: 'correctness',
		changedFiles: ['pool.ts'],
		setupNotes: () => ''
	});

	return { evidence, models, delegate };
}

test('a worker runs on the second model and reports only evidence ids the store holds', async () => {
	useTwoModels();

	const { evidence, models, delegate } = stubWorker();
	const result = await delegate({ action: 'delegate', task: 'Which lines of pool.ts changed?' });
	const [recordId] = evidence.records.keys();

	expect(models).toEqual(['worker', 'worker']);
	expect(result.ok).toBe(true);
	expect(result.content).toContain(`- ${recordId}: pool.ts`);
	expect(result.content).not.toContain('E999');
});

test('a reviewer past its delegation cap is refused without a model call', async () => {
	useTwoModels();

	const { models, delegate } = stubWorker();

	for (let i = 0; i < REVIEW_POLICY.maxDelegationsPerAgent; i++)
		expect((await delegate({ action: 'delegate', task: 'Which lines changed?' })).ok).toBe(true);

	const calls = models.length;
	const refused = await delegate({ action: 'delegate', task: 'One more?' });

	expect(refused.ok).toBe(false);
	expect(models).toHaveLength(calls);
});
