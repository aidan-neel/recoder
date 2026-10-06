import { expect, test } from 'bun:test';
import { applyRepair, isRepairable, planRepair, type RepairScope } from '../../../src/review/pipeline/candidate-repair';
import { candidateOf, repairContext, reported } from './candidate-repair-fixtures';

function scopeOf(ctx = repairContext()): RepairScope {
	return { inventory: ctx.inventory, ledger: ctx.ledger, intent: ctx.intent };
}

test('a supported candidate anchored on the wrong line moves to the changed line its path cites and passes validation', () => {
	const ctx = repairContext();
	const candidate = candidateOf(reported(), 'correctness', ctx);
	const { id, candidateId } = candidate;

	expect(candidate.dropReason).toBe('new-side line is not associated with this change');
	expect(isRepairable(candidate)).toBe(true);

	const plan = planRepair(candidate, scopeOf(ctx));

	expect(plan).toEqual({
		changes: [{ kind: 'anchor', file: 'src/q.ts', line: 14, basis: 'cited: persistNext(next);' }],
		open: []
	});

	const repair = applyRepair(candidate, plan.changes, 'deterministic', ctx);

	expect(repair.result).toBe('revalidated');
	expect(repair.original).toMatchObject({ file: 'src/q.ts', line: 30, stage: 'location' });
	expect(candidate).toMatchObject({ valid: true, file: 'src/q.ts', line: 14, id, candidateId });
	expect(candidate.dropStage).toBeUndefined();
	expect(candidate.relatedLocations).toContainEqual(expect.objectContaining({ file: 'src/q.ts', line: 30 }));
});

test('an invented path stays rejected with its original stop, and the repair says why', () => {
	const candidate = candidateOf(reported({ file: 'src/invented.ts' }));
	const before = structuredClone(candidate);
	const plan = planRepair(candidate, scopeOf());

	expect(isRepairable(candidate)).toBe(true);
	expect(plan.unsupported).toBe('path is not in the change inventory; a repair never moves a finding to another path');
	expect(plan.changes).toEqual([]);
	expect(candidate).toEqual(before);
});

test('a candidate whose evidence ties no changed line to it leaves the line open instead of guessing', () => {
	const raw = reported({
		claim: { ...reported().claim, executionPath: [{ file: 'src/q.ts', line: 3, note: 'start' }] }
	});

	const plan = planRepair(candidateOf(raw), scopeOf());

	expect(plan.changes).toEqual([]);
	expect(plan.open).toEqual([{ need: 'line', reason: 'no changed line in src/q.ts holds code the candidate cites' }]);
});

test('two changed lines equally supported are a tie the diff does not settle', () => {
	const steps = [12, 44].map((line) => ({ file: 'src/q.ts', line, note: 'a step' }));
	const raw = reported({ line: 28, claim: { ...reported().claim, executionPath: steps } });

	expect(planRepair(candidateOf(raw), scopeOf()).open).toEqual([
		{ need: 'line', reason: 'lines 12 and 44 are equally supported (cited)' }
	]);
});

/** An intent-mismatch in the api-contract lens on added line 14, whose path runs through the change. */
function apiMismatch(violatedContract: string, ctx = repairContext()) {
	const claim = { ...reported().claim, violatedContract };

	return candidateOf(reported({ line: 14, category: 'intent-mismatch', claim }), 'api-contract', ctx);
}

test('an intent-mismatch citing a claim the intent does not hold is unsupported, never relabelled', () => {
	const ctx = repairContext();

	for (const [contract, id] of [
		['G9: the queue is persisted after each item', 'G9'],
		['D1 says the queue is persisted after each item', 'D1']
	]) {
		const candidate = apiMismatch(contract, ctx);
		const before = structuredClone(candidate);

		expect(candidate.dropReason).toBe('intent-mismatch finding cites no intent claim id');

		expect(planRepair(candidate, scopeOf(ctx))).toEqual({
			changes: [],
			open: [],
			unsupported: `the finding cites ${id}, which the intent does not hold; a repair never invents a claim`
		});

		expect(candidate).toEqual(before);
	}
});

test('an intent-mismatch citing no claim id leaves the category to the model, even when its lens has one other', () => {
	const ctx = repairContext();
	const plan = planRepair(apiMismatch('the queue is persisted after each item', ctx), scopeOf(ctx));

	expect(plan).toEqual({
		changes: [],
		open: [{ need: 'category', issue: 'intent', reason: 'intent-mismatch finding cites no intent claim id' }]
	});
});

test('an intent-mismatch whose path touches no changed line keeps its category and stays rejected', () => {
	const steps = [{ file: 'src/q.ts', line: 16, note: 'returns the queue' }];
	const claim = { ...reported().claim, executionPath: steps, violatedContract: 'the queue order is broken' };
	const candidate = candidateOf(reported({ line: 10, category: 'intent-mismatch', claim }), 'api-contract');

	expect(planRepair(candidate, scopeOf())).toEqual({
		changes: [],
		open: [],
		unsupported: 'no step of its execution path is a line the change added'
	});
});

test('an intent-mismatch that names a held claim outside its contract cites it', () => {
	const ctx = repairContext();
	const raw = reported({ line: 14, category: 'intent-mismatch', body: 'This reorders items, against G1.' });
	const plan = planRepair(candidateOf(raw, 'correctness', ctx), scopeOf(ctx));

	expect(plan.changes).toEqual([
		{ kind: 'citation', claimId: 'G1', basis: 'the finding names G1 outside violatedContract' }
	]);

	const candidate = candidateOf(raw, 'correctness', ctx);

	applyRepair(candidate, plan.changes, 'deterministic', ctx);
	expect(candidate.claim?.violatedContract).toBe('G1: Each item is handled once');

	const invented = reported({ line: 14, category: 'intent-mismatch', body: 'Against G1 and G7.' });

	expect(planRepair(candidateOf(invented, 'correctness', ctx), scopeOf(ctx)).unsupported).toBe(
		'the finding cites G7, which the intent does not hold; a repair never invents a claim'
	);
});

test('an intent-mismatch in a lens with several other categories leaves the category to choose', () => {
	const raw = reported({ line: 14, category: 'intent-mismatch' });

	expect(planRepair(candidateOf(raw), scopeOf()).open).toEqual([
		{ need: 'category', issue: 'intent', reason: 'intent-mismatch finding cites no intent claim id' }
	]);
});

test('a convention finding without examples is never given made-up ones', () => {
	const candidate = candidateOf(reported({ line: 14, category: 'convention' }), 'conventions');

	expect(planRepair(candidate, scopeOf()).unsupported).toBe(
		'convention finding needs two examples; a repair never invents one'
	);
});

test('a repo-rule finding cites a rule only when the ledger has one for the file', () => {
	const ledger = {
		rules: [{ id: 'R1', text: 'Save after each item.', source: { path: 'AGENTS.md' } }],
		sourcesHash: 'h'
	};

	const ctx = { ...repairContext(), ledger };
	const raw = reported({ line: 14, category: 'repo-rule', body: 'Breaks R1: the queue is saved late.' });

	expect(planRepair(candidateOf(raw, 'rules', ctx), scopeOf(ctx)).changes).toEqual([
		{ kind: 'rule', ruleId: 'R1', basis: 'the finding names R1, a ledger rule for this file' }
	]);

	expect(planRepair(candidateOf(raw, 'rules'), scopeOf()).unsupported).toBe('no ledger rule applies to the file');
});

test('a repaired candidate that fails validation again is left as it was', () => {
	const ctx = repairContext();
	const candidate = candidateOf(reported(), 'correctness', ctx);
	const before = structuredClone(candidate);
	const repair = applyRepair(candidate, [{ kind: 'anchor', file: 'src/q.ts', line: 90, basis: 'test' }], 'model', ctx);

	expect(repair).toMatchObject({ result: 'rejected', reason: 'new-side line is not associated with this change' });
	expect(candidate).toEqual(before);
});

test('only a reviewer candidate stopped at location or category, with evidence to rest on, is repairable', () => {
	const bare = reported({ claim: { ...reported().claim, executionPath: [] } });

	expect(isRepairable(candidateOf(bare))).toBe(false);
	expect(isRepairable(candidateOf(reported({ line: 14 })))).toBe(false);

	const unknownEvidence = candidateOf(reported({ line: 14, evidenceIds: ['ev_404'] }));

	expect(unknownEvidence.dropStage).toBe('evidence');
	expect(isRepairable(unknownEvidence)).toBe(false);
	expect(isRepairable({ ...candidateOf(reported()), repair: { result: 'unsupported' } as never })).toBe(false);
});
