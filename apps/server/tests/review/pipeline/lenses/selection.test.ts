import { expect, test } from 'bun:test';
import { assertLensSelection, lensesFor } from '../../../../src/review/pipeline/lenses/lenses';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { partitionReviewers, skippedSlices } from '../../../../src/review/pipeline/reviewers';
import { budgetLimits } from '../../../../src/review/session/review-policy';
import { addedFile } from '../harness-fixtures';

const CODE_SCOPE = [{ path: 'src/a.ts', hunkIds: [] }];

const DOCS_SCOPE = [{ path: 'docs/guide.md', hunkIds: [] }];

test('a slice applies the selected lenses among those that fit it, in the order of the lenses and not of the selection', () => {
	const ids = (scope: typeof CODE_SCOPE, selection: Parameters<typeof lensesFor>[1]) =>
		lensesFor(scope, selection).map((lens) => lens.id);

	expect(ids(CODE_SCOPE, ['readability', 'security', 'correctness'])).toEqual([
		'correctness',
		'security',
		'readability'
	]);

	expect(ids(DOCS_SCOPE, ['readability', 'security', 'correctness'])).toEqual(['readability']);
	expect(ids(DOCS_SCOPE, ['correctness'])).toEqual([]);
});

test('a lens selection that is unset passes, and one that is empty or has an unknown id throws naming it', () => {
	expect(() => assertLensSelection(undefined)).not.toThrow();
	expect(() => assertLensSelection(['correctness', 'rules'])).not.toThrow();
	expect(() => assertLensSelection([])).toThrow('empty list');
	expect(() => assertLensSelection(['correctness', 'speed'])).toThrow('Unknown lens "speed"');
});

test('a slice no selected lens fits has no reviewer, and every hunk is either read or named as skipped with its reason', () => {
	const inventory = buildInventory(addedFile('src/a.ts', 140) + addedFile('docs/guide.md', 140), []);
	const limits = budgetLimits('medium');
	const reviewers = partitionReviewers(inventory, limits, ['correctness']);
	const skipped = skippedSlices(inventory, limits, ['correctness']);
	const hunksOf = (scopes: { hunkIds: string[] }[]) => scopes.flatMap((scope) => scope.hunkIds).sort();

	expect(reviewers.map((reviewer) => [reviewer.id, reviewer.lenses])).toEqual([['reviewer-1', ['correctness']]]);
	expect(skipped.map((slice) => slice.scope.map((entry) => entry.path))).toEqual([['docs/guide.md']]);
	expect(skipped[0].reason).toContain('rules, readability');

	expect(
		hunksOf([...reviewers.flatMap((reviewer) => reviewer.scope), ...skipped.flatMap((slice) => slice.scope)])
	).toEqual(hunksOf(inventory.files.flatMap((file) => file.hunks.map((hunk) => ({ hunkIds: [hunk.id] })))));
});

test('a review of every lens skips no slice', () => {
	const inventory = buildInventory(addedFile('src/a.ts', 140) + addedFile('docs/guide.md', 140), []);

	expect(skippedSlices(inventory, budgetLimits('medium'))).toEqual([]);
});
