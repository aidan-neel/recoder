import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReviewSpeed } from '@recoder/shared';
import { buildRuleLedger } from '../../../../src/review/guidelines/ledger/ledger';
import { createRun } from '../../../../src/review/pipeline/harness/context';
import { settleBackgroundWork } from '../../../../src/util/background-work';
import { DIFF, modelReply, restoreAfterEach, twoCommitRepo, useTestModel } from '../../pipeline/harness-fixtures';

restoreAfterEach();

/** A review of `speed` whose base is `targetSha` in the repo at `root`. */
function reviewAt(root: string, targetSha: string, speed: ReviewSpeed = 'standard') {
	return createRun({
		diff: DIFF,
		sandboxPath: null,
		speed,
		revision: { checkoutPath: root, headSha: targetSha, targetSha, mergeBaseSha: targetSha, targetRef: 'main' }
	});
}

/** A model reply holding one rule quoted from line 1 of AGENTS.md. */
function oneRule(text: string): Response {
	return modelReply({ message: 'Read the rules.', rules: [{ text, source: 'AGENTS.md', line: 1 }] });
}

describe('buildRuleLedger after the guidelines change', () => {
	test("starts the review on the repo's last ledger and distills the new one for the next review", async () => {
		const root = await mkdtemp(join(tmpdir(), 'recoder-ledger-refresh-'));

		const { targetSha: oldBase, headSha: newBase } = await twoCommitRepo(root, {
			base: { 'AGENTS.md': '- Keep files short.\n' },
			head: { 'AGENTS.md': '- Write JSDoc only.\n' }
		});

		useTestModel();

		globalThis.fetch = (async () => oneRule('Keep files short.')) as unknown as typeof fetch;

		await buildRuleLedger(reviewAt(root, oldBase));

		const reply = Promise.withResolvers<Response>();
		const asked = Promise.withResolvers<void>();

		globalThis.fetch = (() => {
			asked.resolve();

			return reply.promise;
		}) as unknown as typeof fetch;

		const started = await buildRuleLedger(reviewAt(root, newBase));

		expect(started?.rules.map((rule) => [rule.text, rule.source.revision])).toEqual([['Keep files short.', newBase]]);

		await asked.promise;
		reply.resolve(oneRule('Write JSDoc only.'));
		await settleBackgroundWork();

		globalThis.fetch = (async () => new Response('unavailable', { status: 500 })) as unknown as typeof fetch;

		const next = await buildRuleLedger(reviewAt(root, newBase));

		expect(next?.rules.map((rule) => rule.text)).toEqual(['Write JSDoc only.']);
	});
});

/** Counts model calls, answering each with one rule quoted from line 1 of AGENTS.md. */
function countCalls(text: string): { calls: number } {
	const seen = { calls: 0 };

	globalThis.fetch = (async () => {
		seen.calls += 1;

		return oneRule(text);
	}) as unknown as typeof fetch;

	return seen;
}

describe('buildRuleLedger in a Spark review', () => {
	test('never asks a model: it goes on without rules, then takes the last ledger without refreshing it', async () => {
		const root = await mkdtemp(join(tmpdir(), 'recoder-ledger-spark-'));

		const { targetSha: oldBase, headSha: newBase } = await twoCommitRepo(root, {
			base: { 'AGENTS.md': '- Name each test as a sentence.\n' },
			head: { 'AGENTS.md': '- Await every storage write.\n' }
		});

		useTestModel();

		const first = countCalls('Name each test as a sentence.');

		expect(await buildRuleLedger(reviewAt(root, oldBase, 'spark'))).toBeNull();
		expect(first.calls).toBe(0);

		await buildRuleLedger(reviewAt(root, oldBase));

		const later = countCalls('Await every storage write.');
		const ledger = await buildRuleLedger(reviewAt(root, newBase, 'spark'));

		await settleBackgroundWork();

		expect(ledger?.rules.map((rule) => rule.text)).toEqual(['Name each test as a sentence.']);
		expect(later.calls).toBe(0);
	});
});
