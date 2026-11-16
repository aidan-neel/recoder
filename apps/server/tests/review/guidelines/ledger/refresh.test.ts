import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRuleLedger } from '../../../../src/review/guidelines/ledger/ledger';
import { createRun } from '../../../../src/review/pipeline/harness/context';
import { settleBackgroundWork } from '../../../../src/util/background-work';
import { DIFF, modelReply, restoreAfterEach, twoCommitRepo, useTestModel } from '../../pipeline/harness-fixtures';

restoreAfterEach();

/** A review whose base is `targetSha` in the repo at `root`. */
function reviewAt(root: string, targetSha: string) {
	return createRun({
		diff: DIFF,
		sandboxPath: null,
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
