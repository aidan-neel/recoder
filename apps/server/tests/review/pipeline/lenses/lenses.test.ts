import { expect, test } from 'bun:test';
import { LENSES, lensOwning, lensesFor } from '../../../../src/review/pipeline/lenses/lenses';

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

test('a finding is credited to the first lens of the reviewer that owns its category', () => {
	expect(lensOwning('security', ALL)).toBe('security');
	expect(lensOwning('intent-mismatch', ALL)).toBe('correctness');
	expect(lensOwning('security', ['rules', 'readability'])).toBeUndefined();
});
