import { expect, test } from 'bun:test';
import { planRepair, type RepairChange, type RepairScope } from '../../../src/review/pipeline/candidate-repair';
import {
	changesFromAnswer,
	nothingToOffer,
	repairAnswerSchema,
	repairOptions,
	repairPrompt
} from '../../../src/review/pipeline/candidate-repair-model';
import { candidateOf, repairContext, reported } from './candidate-repair-fixtures';

const ctx = repairContext();
const scope: RepairScope = { inventory: ctx.inventory, ledger: null, intent: ctx.intent };

/** A candidate on line 30 whose only path step is unchanged, so the diff leaves its line open. */
const lost = candidateOf(reported({ claim: { ...reported().claim, executionPath: [{ file: 'src/q.ts', line: 3 }] } }));
const lostPlan = planRepair(lost, scope);
const lineOptions = repairOptions(lost, lostPlan, scope);

/** An intent-mismatch in the correctness lens, whose category is left open. */
const mismatch = candidateOf(reported({ line: 14, category: 'intent-mismatch' }));
const mismatchPlan = planRepair(mismatch, scope);
const categoryOptions = repairOptions(mismatch, mismatchPlan, scope);

const answer = (over: object) => repairAnswerSchema.parse({ reason: 'it fits', ...over });

test('a call is offered only changed code lines, and the categories and claims that exist', () => {
	expect(lineOptions.lines.map((line) => line.line)).toEqual([11, 12, 14, 44]);
	expect(lineOptions.categories).toEqual([]);
	expect(categoryOptions.lines).toEqual([]);
	expect(categoryOptions.categories).toEqual(['correctness', 'error-handling', 'tests']);
	expect(categoryOptions.claims.map((claim) => claim.id)).toEqual(['G1']);
	expect(repairPrompt(lost, lostPlan, lineOptions, ctx.evidence)).toContain('\nsrc/q.ts:14 persistNext(next);');
});

test('a chosen line, named by its path and line number, becomes an anchor change on that changed line', () => {
	const anchored: RepairChange[] = [{ kind: 'anchor', file: 'src/q.ts', line: 14, basis: 'model: it fits' }];

	expect(changesFromAnswer(answer({ file: 'src/q.ts', line: 14 }), lostPlan, lineOptions)).toEqual(anchored);
	expect(changesFromAnswer(answer({ line: 14 }), lostPlan, lineOptions)).toEqual(anchored);
});

test('a line outside the options, or none, leaves the candidate rejected', () => {
	const none = 'the model chose no offered line';

	expect(changesFromAnswer(answer({ line: 13 }), lostPlan, lineOptions)).toBe(none);
	expect(changesFromAnswer(answer({ file: 'src/other.ts', line: 14 }), lostPlan, lineOptions)).toBe(none);
	expect(changesFromAnswer(answer({ line: null }), lostPlan, lineOptions)).toBe(none);
});

test('an open choice with nothing to offer needs no call; one with options does', () => {
	const noLines = { ...lineOptions, lines: [] };
	const noCategories = { ...categoryOptions, categories: [], claims: [] };

	expect(nothingToOffer(lostPlan, noLines)).toBe(
		'no changed line in src/q.ts holds code the candidate cites, and no changed line in the files it cites to offer'
	);

	expect(nothingToOffer(mismatchPlan, noCategories)).toBe(
		'intent-mismatch finding cites no intent claim id, and no category, claim or rule to offer'
	);

	expect(nothingToOffer(lostPlan, lineOptions)).toBeNull();
	expect(nothingToOffer(mismatchPlan, categoryOptions)).toBeNull();
});

test('a category or claim must be one offered; a made-up claim or another lens’s category is refused', () => {
	const refused = 'the model chose no offered category, claim or rule';

	expect(changesFromAnswer(answer({ category: 'security' }), mismatchPlan, categoryOptions)).toBe(refused);
	expect(changesFromAnswer(answer({ claimId: 'G7' }), mismatchPlan, categoryOptions)).toBe(refused);
	expect(changesFromAnswer(answer({ claimId: 'D1' }), mismatchPlan, categoryOptions)).toBe(refused);

	expect(changesFromAnswer(answer({ claimId: 'G1' }), mismatchPlan, categoryOptions)).toEqual([
		{ kind: 'citation', claimId: 'G1', basis: 'model: it fits' }
	]);

	expect(changesFromAnswer(answer({ category: 'tests' }), mismatchPlan, categoryOptions)).toEqual([
		{ kind: 'category', category: 'tests', basis: 'model: it fits' }
	]);
});
