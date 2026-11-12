import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOKEN_BUDGET_PLANS, type TokenBudget } from '@recoder/shared';
import { runAdaptiveReview } from '../../../src/review/pipeline/harness';
import { budgetLimits } from '../../../src/review/session/review-policy';
import { getStoredSettings, setReviewOverrides } from '../../../src/review/session/review-settings';
import { NOTHING, addedFile, messagesOf, modelReply, restoreAfterEach, unitOf, useTestModel } from './harness-fixtures';

restoreAfterEach();

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-budget-'));
});

/** Eight files in eight folders, about 14,000 patch characters each: over the larger-change threshold, in eight brief units. */
const DIFF = Array.from({ length: 8 }, (_, index) => addedFile(`pkg${index}/index.ts`, 140)).join('');

/** What a review spent, by the agent that spent it. */
interface Spend {
	/** Model calls each reviewer made. */
	reviewers: Map<string, number>;
	/** Model calls each subagent made. */
	subagents: Map<string, number>;
	/** The model-call ceiling when the first stage reported it, before verifiers add their own room. */
	initialCeiling: number | null;
}

/** The subagent ids a prompt is for. */
const subagentOf = (init?: RequestInit) => /^Subagent (\S+):/m.exec(messagesOf(init)[1]?.content ?? '')?.[1] ?? null;

/**
 * Runs a review whose reviewers keep reading until their final turn and each ask for three subagents, and whose
 * subagents do the same, so the calls each makes show how many turns it was given and how many subagents ran.
 */
async function spendUnder(tokenBudget: TokenBudget | undefined): Promise<Spend> {
	const spend: Spend = { reviewers: new Map(), subagents: new Map(), initialCeiling: null };

	useTestModel();
	setReviewOverrides({ ...getStoredSettings(), maxDiffChars: 200_000 });

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const unit = unitOf(init);
		const subagent = subagentOf(init);
		const last = messagesOf(init).at(-1)?.content ?? '';

		if (unit) spend.reviewers.set(unit, (spend.reviewers.get(unit) ?? 0) + 1);
		if (subagent) spend.subagents.set(subagent, (spend.subagents.get(subagent) ?? 0) + 1);

		if ((unit || subagent) && !last.includes('This is your final turn'))
			return modelReply({ message: 'Reading.', actions: [{ action: 'readDiff', path: 'pkg0/index.ts' }] });

		const asks = unit ? [1, 2, 3].map((index) => ask(`${unit} question ${index}`)) : [];

		return modelReply({ message: 'ok', ...NOTHING, subagents: asks });
	}) as unknown as typeof fetch;

	const plan = TOKEN_BUDGET_PLANS[tokenBudget ?? 'medium'];

	await runAdaptiveReview(
		{ diff: DIFF, sandboxPath: null, subagentCap: plan.subagentCap, ...(tokenBudget && { tokenBudget }) },
		{
			onBudget: (budget) => {
				spend.initialCeiling ??= budget.limit;
			}
		}
	);

	return spend;
}

const ask = (concern: string) => ({
	concern,
	question: `${concern}?`,
	scope: [{ path: 'pkg0/index.ts', hunkIds: [] }],
	why: 'Needs a look across the repo.'
});

/** The calls every agent of a kind made, as one list. */
const calls = (spent: Map<string, number>) => [...spent.values()];

test('a review with no budget runs as Medium: three reviewers of twelve turns and eight subagents of eight turns', async () => {
	const none = await spendUnder(undefined);
	const medium = await spendUnder('medium');

	expect(none).toEqual(medium);
	expect([...medium.reviewers.keys()].sort()).toEqual(['reviewer-1', 'reviewer-2', 'reviewer-3']);
	expect(calls(medium.reviewers)).toEqual([12, 12, 12]);
	expect(calls(medium.subagents)).toEqual(Array(8).fill(8));
	expect(medium.initialCeiling).toBe(120 + 8 + 3 * (12 + 4) + 8 * (8 + 4));
});

test('a Low budget runs one reviewer and up to three subagents, each with fewer turns and a lower ceiling', async () => {
	const low = await spendUnder('low');

	expect([...low.reviewers.keys()].sort()).toEqual(['reviewer-1']);
	expect(calls(low.reviewers)).toEqual([budgetLimits('low').reviewerTurns]);
	expect(calls(low.subagents)).toEqual(Array(3).fill(budgetLimits('low').subagentTurns));
	expect(low.initialCeiling).toBe(80 + 8 + (8 + 4) + 3 * (5 + 4));
});

test('a High budget runs four reviewers and up to twelve subagents, each with more turns and a higher ceiling', async () => {
	const high = await spendUnder('high');

	expect([...high.reviewers.keys()].sort()).toEqual(['reviewer-1', 'reviewer-2', 'reviewer-3', 'reviewer-4']);
	expect(calls(high.reviewers)).toEqual(Array(4).fill(budgetLimits('high').reviewerTurns));
	expect(calls(high.subagents)).toEqual(Array(12).fill(budgetLimits('high').subagentTurns));
	expect(high.initialCeiling).toBe(160 + 8 + 4 * (16 + 4) + 12 * (10 + 4));
});
