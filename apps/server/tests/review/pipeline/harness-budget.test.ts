import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TokenBudget } from '@recoder/shared';
import { runAdaptiveReview } from '../../../src/review/pipeline/harness';
import { budgetLimits } from '../../../src/review/session/review-policy';
import { NOTHING, messagesOf, modelReply, restoreAfterEach, systemOf, unitOf, useTestModel } from './harness-fixtures';

restoreAfterEach();

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-budget-'));
});

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
`;

const SUBAGENT_ASK = {
	concern: 'Callers of parse',
	question: 'Is every caller handled?',
	scope: [{ path: 'src/a.ts', hunkIds: [] }],
	why: 'Needs a look across the repo.'
};

/** What a review spent, by the agent that spent it. */
interface Spend {
	/** Model calls each lens reviewer made. */
	lenses: Map<string, number>;
	subagentCalls: number;
	/** The model-call ceiling when the first stage reported it, before verifiers add their own room. */
	initialCeiling: number | null;
}

/**
 * Runs a one-unit review whose reviewers keep reading until their final turn and whose correctness lens asks for
 * a subagent, so the calls each makes show how many turns it was given.
 */
async function spendUnder(tokenBudget: TokenBudget | undefined): Promise<Spend> {
	const spend: Spend = { lenses: new Map(), subagentCalls: 0, initialCeiling: null };

	useTestModel();

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const unit = unitOf(init);
		const subagent = systemOf(init).includes('Role: subagent');
		const last = messagesOf(init).at(-1)?.content ?? '';

		if (unit) spend.lenses.set(unit, (spend.lenses.get(unit) ?? 0) + 1);
		if (subagent) spend.subagentCalls++;

		if ((unit || subagent) && !last.includes('This is your final turn'))
			return modelReply({ message: 'Reading.', actions: [{ action: 'readDiff', path: 'src/a.ts' }] });

		const subagents = unit === 'unit-1/correctness' ? [SUBAGENT_ASK] : [];

		return modelReply({ message: 'ok', ...NOTHING, subagents });
	}) as unknown as typeof fetch;

	await runAdaptiveReview(
		{ diff: DIFF, sandboxPath: null, subagentCap: 2, ...(tokenBudget && { tokenBudget }) },
		{
			onBudget: (budget) => {
				spend.initialCeiling ??= budget.limit;
			}
		}
	);

	return spend;
}

const ALL_LENSES = [
	'correctness',
	'security',
	'concurrency',
	'api-contract',
	'performance',
	'rules',
	'conventions',
	'readability'
];

test('a review with no budget spends exactly what Medium does, which is the limits before budgets existed', async () => {
	const none = await spendUnder(undefined);
	const medium = await spendUnder('medium');

	expect(none).toEqual(medium);
	expect([...medium.lenses.keys()]).toEqual(ALL_LENSES.map((lens) => `unit-1/${lens}`));
	expect([...medium.lenses.values()]).toEqual(ALL_LENSES.map(() => 6));
	expect(medium.subagentCalls).toBe(8);
	expect(medium.initialCeiling).toBe(320 + 8 * ALL_LENSES.length);
});

test('a Low budget leaves out the performance and maintainability lenses and gives each agent fewer turns and a lower ceiling', async () => {
	const low = await spendUnder('low');
	const lenses = ['correctness', 'security', 'concurrency', 'api-contract', 'rules'];

	expect([...low.lenses.keys()]).toEqual(lenses.map((lens) => `unit-1/${lens}`));
	expect([...low.lenses.values()]).toEqual(lenses.map(() => budgetLimits('low').lensTurns));
	expect(low.subagentCalls).toBe(budgetLimits('low').subagentTurns);
	expect(low.initialCeiling).toBe(200 + 6 * lenses.length);
});

test('a High budget gives every lens and subagent more turns and a higher ceiling', async () => {
	const high = await spendUnder('high');

	expect([...high.lenses.keys()]).toEqual(ALL_LENSES.map((lens) => `unit-1/${lens}`));
	expect([...high.lenses.values()]).toEqual(ALL_LENSES.map(() => budgetLimits('high').lensTurns));
	expect(high.subagentCalls).toBe(budgetLimits('high').subagentTurns);
	expect(high.initialCeiling).toBe(480 + 12 * ALL_LENSES.length);
});
