import { expect, test } from 'bun:test';
import { applyRepair, categoryOptions, planRepair } from '../../../src/review/pipeline/candidate-repair';
import { lensCategories } from '../../../src/review/pipeline/lenses/lenses';
import { candidateOf, repairContext, reported } from './candidate-repair-fixtures';

/** A readability finding on an unchanged line, which a repair can link to the added line its path cites. */
const READABILITY = reported({ category: 'readability', smell: 'magic-value' });

test('a repaired candidate is validated again against the lens selection, so a repair cannot publish outside it', () => {
	const ctx = repairContext();

	const plan = planRepair(candidateOf(READABILITY, 'readability', ctx), {
		inventory: ctx.inventory,
		ledger: null,
		intent: ctx.intent
	});

	const outside = candidateOf(READABILITY, 'readability', ctx);
	const inside = candidateOf(READABILITY, 'readability', ctx);

	expect(applyRepair(outside, plan.changes, 'deterministic', { ...ctx, selection: ['correctness'] })).toMatchObject({
		result: 'rejected',
		reason: expect.stringContaining('outside the lenses this review applies (correctness)')
	});

	expect(outside.valid).toBe(false);

	expect(applyRepair(inside, plan.changes, 'deterministic', { ...ctx, selection: ['readability'] }).result).toBe(
		'revalidated'
	);
});

test('a corrected category for a candidate no lens is credited with is chosen among the selected lenses', () => {
	const uncredited = candidateOf(reported({ category: 'performance' }), 'correctness');

	expect(categoryOptions(uncredited, ['security'])).toEqual(lensCategories(['security']));
	expect(categoryOptions(uncredited)).toContain('readability');
});
