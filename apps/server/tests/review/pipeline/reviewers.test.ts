import { expect, test } from 'bun:test';
import { buildInventory } from '../../../src/review/pipeline/inventory';
import { partitionReviewers, reviewerCount } from '../../../src/review/pipeline/reviewers';
import { budgetLimits } from '../../../src/review/session/review-policy';
import { TOKEN_BUDGETS } from '@recoder/shared';
import { addedFile } from './harness-fixtures';

/** `files` files of about 14,000 patch characters each, in folders of their own. */
const change = (files: number, ext = 'ts') =>
	Array.from({ length: files }, (_, index) => addedFile(`pkg${index}/index.${ext}`, 140)).join('');

const countFor = (diff: string, budget: (typeof TOKEN_BUDGETS)[number]) =>
	reviewerCount(buildInventory(diff, []), budgetLimits(budget));

test('Low has one reviewer, Medium two for a small change and three for a larger one, High four', () => {
	expect(TOKEN_BUDGETS.map((budget) => countFor(change(3), budget))).toEqual([1, 2, 3]);
	expect(TOKEN_BUDGETS.map((budget) => countFor(change(8), budget))).toEqual([1, 3, 4]);
	expect(TOKEN_BUDGETS.map((budget) => countFor(change(2), budget))).toEqual([1, 2, 2]);
});

test('a change over 48,000 patch characters is a larger change, and one at it is not', () => {
	expect(countFor(change(3), 'medium')).toBe(2);
	expect(countFor(change(4), 'medium')).toBe(3);
});

test('a reviewer is never added without a hunk to read, and a documentation-only change has one', () => {
	expect(countFor(addedFile('src/a.ts', 5), 'high')).toBe(1);
	expect(countFor(change(8, 'md'), 'high')).toBe(1);
});

/** One file `lib/big.ts` of `hunks` hunks of `lines` 100-character lines each. */
function bigFile(hunks: number, lines: number): string {
	const hunk = (index: number) => {
		const body = Array.from({ length: lines }, (_, line) => `+${String(line).padEnd(99, 'z')}`).join('\n');

		return `@@ -${index * 1000 + 1},0 +${index * 1000 + 1},${lines} @@\n${body}`;
	};

	return `diff --git a/lib/big.ts b/lib/big.ts\n--- a/lib/big.ts\n+++ b/lib/big.ts\n${Array.from({ length: hunks }, (_, index) => hunk(index)).join('\n')}\n`;
}

test('every changed hunk is read by exactly one reviewer, whatever the budget and the size of the change', () => {
	const hunky = bigFile(6, 120);

	for (const diff of [change(1), change(3), change(8), change(8) + hunky, hunky]) {
		const inventory = buildInventory(diff, []);
		const wanted = inventory.files.flatMap((file) => file.hunks.map((hunk) => hunk.id)).sort();

		for (const budget of TOKEN_BUDGETS) {
			const reviewers = partitionReviewers(inventory, budgetLimits(budget));
			const read = reviewers.flatMap((reviewer) => reviewer.scope.flatMap((entry) => entry.hunkIds)).sort();

			expect(reviewers.length).toBeLessThanOrEqual(reviewerCount(inventory, budgetLimits(budget)));
			expect(read).toEqual(wanted);
			expect(reviewers.map((reviewer) => reviewer.id)).toEqual(reviewers.map((_, index) => `reviewer-${index + 1}`));
		}
	}
});

test('a file too large for one reviewer is read by two, hunk by hunk, and the slices are balanced', () => {
	const diff = bigFile(4, 100);

	const reviewers = partitionReviewers(buildInventory(diff, []), budgetLimits('medium'));

	expect(reviewers.map((reviewer) => reviewer.scope[0].hunkIds.length)).toEqual([2, 2]);
	expect(reviewers.every((reviewer) => reviewer.scope.length === 1)).toBe(true);
});

test('the same change gives the same reviewers, and a slice of code applies every lens while a slice of docs applies two', () => {
	const diff = addedFile('docs/guide.md', 140) + addedFile('src/a.ts', 140);
	const forward = partitionReviewers(buildInventory(diff, []), budgetLimits('medium'));
	const lensesOf = (reviewers: typeof forward) => reviewers.map((reviewer) => reviewer.lenses);

	expect(partitionReviewers(buildInventory(diff, []), budgetLimits('medium'))).toEqual(forward);

	expect(lensesOf(forward)).toEqual([
		['rules', 'readability'],
		['correctness', 'security', 'concurrency', 'api-contract', 'performance', 'rules', 'conventions', 'readability']
	]);
});
