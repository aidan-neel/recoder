import { expect, test } from 'bun:test';
import {
	LENSES,
	combinedProcedure,
	lensCategories,
	lensOwning,
	lensesFor
} from '../../../../src/review/pipeline/lenses/lenses';
import { reviewerSystemPrompt } from '../../../../src/review/pipeline/reviewer-prompts';

const ALL = LENSES.map((lens) => lens.id);

test('a documentation-only slice applies only the rules and readability lenses, and a slice with code applies all of them', () => {
	expect(lensesFor([{ path: 'docs/guide.md', hunkIds: [] }]).map((lens) => lens.id)).toEqual(['rules', 'readability']);

	expect(
		lensesFor([
			{ path: 'docs/guide.md', hunkIds: [] },
			{ path: 'src/a.ts', hunkIds: [] }
		]).map((lens) => lens.id)
	).toEqual(ALL);
});

test('one combined prompt holds every lens procedure once, and the categories of every lens each once', () => {
	const prompt = reviewerSystemPrompt(ALL, false, null, { subagents: 4, unsettled: true, delegate: false });
	const categories = lensCategories(ALL);

	expect(new Set(categories).size).toBe(categories.length);

	for (const lens of LENSES) {
		expect(prompt.split(lens.procedure)).toHaveLength(2);
		expect(prompt).toContain(`${lens.title} (${lens.categories.join(', ')}):`);
	}

	expect(prompt).toContain(`report only these categories: ${categories.join(', ')}`);
	expect(combinedProcedure(LENSES).split('intent-mismatch; cite the claim id')).toHaveLength(2);
});

test('a finding is credited to the first lens of the reviewer that owns its category', () => {
	expect(lensOwning('security', ALL)).toBe('security');
	expect(lensOwning('intent-mismatch', ALL)).toBe('correctness');
	expect(lensOwning('security', ['rules', 'readability'])).toBeUndefined();
});

test('a reviewer is told how many subagents to ask for, most important first, and none when they are off', () => {
	const on = reviewerSystemPrompt(ALL, false, null, { subagents: 4, unsettled: false, delegate: false });
	const off = reviewerSystemPrompt(ALL, false, null, { subagents: 0, unsettled: false, delegate: false });

	expect(on).toContain('at most 4, the most important first');
	expect(off).toContain('Leave "subagents" empty.');
	expect(off).not.toContain('hand deep dives to subagents');
});
