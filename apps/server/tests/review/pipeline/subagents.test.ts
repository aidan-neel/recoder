import { expect, test } from 'bun:test';
import type { CodeClaim } from '../../../src/review/pipeline/intent/types';
import { buildInventory } from '../../../src/review/pipeline/inventory';
import {
	planBriefSubagents,
	planSubagents,
	recordAnswered,
	recordUnsettled,
	restoreSubagentState,
	type BriefPlanInput,
	type UnitRequest
} from '../../../src/review/pipeline/subagents';
import { partitionUnits } from '../../../src/review/pipeline/units';
import { TWO_UNIT_DIFF } from './harness-fixtures';

const inventory = buildInventory(TWO_UNIT_DIFF, []);
const units = partitionUnits(inventory);

/** A request from `unitId` about `concern` over the whole of `path`. */
function ask(unitId: string, concern: string, path: string): UnitRequest {
	return {
		unitId,
		unitTitle: unitId,
		request: { concern, question: `Is ${concern} safe?`, scope: [{ path, hunkIds: [] }], why: 'w' }
	};
}

test('requests run in unit order up to the cap, and the rest are dropped', () => {
	const plan = planSubagents(
		[
			ask('unit-2', 'Test isolation', 'tests/b.ts'),
			ask('unit-2', 'Fixture reuse', 'tests/b.ts'),
			ask('unit-1', 'Callers of parse', 'src/a.ts'),
			ask('unit-1', 'Error paths', 'src/a.ts')
		],
		units,
		inventory,
		2
	);

	expect(plan.units.map((unit) => [unit.id, unit.title])).toEqual([
		['subagent-1', 'Callers of parse'],
		['subagent-2', 'Error paths']
	]);

	expect(plan.dropped.map((entry) => entry.request.concern)).toEqual(['Test isolation', 'Fixture reuse']);
});

test('a request with the same concern over overlapping hunks as an earlier one is merged, not counted', () => {
	const plan = planSubagents(
		[
			ask('unit-1', 'Callers of parse', 'src/a.ts'),
			ask('unit-2', '  callers of  PARSE ', 'src/a.ts'),
			ask('unit-2', 'Callers of parse', 'tests/b.ts')
		],
		units,
		inventory,
		4
	);

	expect(plan.units.map((unit) => [unit.title, unit.scope.map((entry) => entry.path)])).toEqual([
		['Callers of parse', ['src/a.ts']],
		['Callers of parse', ['tests/b.ts']]
	]);

	expect(plan.dropped).toEqual([]);
});

test('a scope outside the review falls back to the requesting unit, and a file named without hunks means all of them', () => {
	const plan = planSubagents(
		[ask('unit-2', 'Ghost file', 'nowhere.ts'), ask('unit-1', 'Whole file', 'src/a.ts')],
		units,
		inventory,
		4
	);

	const whole = inventory.files.find((file) => file.path === 'src/a.ts')!.hunks.map((hunk) => hunk.id);

	expect(plan.units.find((unit) => unit.title === 'Ghost file')!.scope).toEqual(units[1].scope);
	expect(plan.units.find((unit) => unit.title === 'Whole file')!.scope).toEqual([{ path: 'src/a.ts', hunkIds: whole }]);
});

test('with subagents off nothing runs and nothing is reported dropped', () => {
	expect(planSubagents([ask('unit-1', 'Callers of parse', 'src/a.ts')], units, inventory, 0)).toEqual({
		units: [],
		dropped: []
	});
});

/** `src/a.ts` with one change near line 2 and another near line 52, so it has two hunks. */
const TWO_HUNK_DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
@@ -51,3 +51,3 @@
 fifty-one
-fifty-two
+FIFTY-TWO
 fifty-three
`;

const hunkInventory = buildInventory(TWO_HUNK_DIFF, []);
const hunkUnits = partitionUnits(hunkInventory);
const [firstHunk, secondHunk] = hunkInventory.files[0].hunks.map((hunk) => hunk.id);

/** A brief question at `line` of `src/a.ts`. */
const question = (id: string, line: number, text = `Does ${id} hold?`): CodeClaim => ({
	id,
	text,
	file: 'src/a.ts',
	line
});

/** Marks by the lens assignments `by` on each question in `ids`. */
const marks = (ids: string[], by: string[]) =>
	ids.flatMap((questionId) => by.map((unitId) => ({ questionId, unitId })));

/** `outcome` answers by the lens assignment `by` on each question in `ids`. */
const answers = (ids: string[], by: string, outcome: 'confirmed' | 'disproved' = 'disproved') =>
	ids.map((questionId) => ({ questionId, unitId: by, outcome }));

/** Plans brief subagents over the two-hunk file with `room` left. */
function planBrief(
	brief: Partial<BriefPlanInput>,
	room = 4,
	requested: ReturnType<typeof planSubagents>['units'] = []
) {
	const plan = planBriefSubagents(
		{ questions: [], marks: [], answers: [], ...brief },
		requested,
		hunkUnits,
		hunkInventory,
		room
	);

	return [...plan.unsettled, ...plan.unaddressed];
}

test('an unsettled question becomes a subagent that carries the question and its hunk', () => {
	const [unit] = planBrief({
		questions: [question('Q1', 2, 'Does render() still accept old?')],
		marks: marks(['Q1'], ['unit-1/correctness'])
	});

	expect(unit.id).toBe('subagent-1');
	expect(unit.scope).toEqual([{ path: 'src/a.ts', hunkIds: [firstHunk] }]);
	expect(unit.reason).toContain('Q1');
	expect(unit.reason).toContain('marked unsettled by 1 reviewer');
	expect(unit.reason).toContain('Does render() still accept old?');
});

test('a question marked by two lenses is planned before one marked by one', () => {
	const units = planBrief({
		questions: [question('Q1', 2), question('Q2', 52), question('Q3', 52)],
		marks: [...marks(['Q1', 'Q3'], ['unit-1/correctness']), ...marks(['Q3'], ['unit-1/security'])]
	});

	expect(units.map((unit) => unit.reason.split('\n')[0])).toEqual([
		'Brief question Q3, marked unsettled by 2 reviewers.',
		'Brief question Q1, marked unsettled by 1 reviewer.',
		'Brief question Q2, no reviewer reported on it.'
	]);
});

test('an unanswered question gets a subagent even with a finding beside it, and an answered one does not', () => {
	const units = planBrief({
		questions: [question('Q1', 2), question('Q2', 52), question('Q3', 53)],
		answers: [...answers(['Q1'], 'unit-1/correctness', 'confirmed'), ...answers(['Q3'], 'unit-1/security')]
	});

	expect(units.map((unit) => [unit.reason.split('\n')[0], unit.scope[0].hunkIds])).toEqual([
		['Brief question Q2, no reviewer reported on it.', [secondHunk]]
	]);
});

test('a question one lens answered and another left unsettled stays in the unsettled tier', () => {
	const units = planBrief({
		questions: [question('Q1', 2)],
		marks: marks(['Q1'], ['unit-1/security']),
		answers: answers(['Q1'], 'unit-1/correctness')
	});

	expect(units.map((unit) => unit.reason.split('\n')[0])).toEqual([
		'Brief question Q1, marked unsettled by 1 reviewer.'
	]);
});

test('questions fill only the room explicit requests leave under the cap, marked ones first', () => {
	const questions = [question('Q1', 2), question('Q2', 52)];
	const requests = [ask('unit-1', 'Callers of parse', 'src/a.ts'), ask('unit-1', 'Error paths', 'src/a.ts')];
	const requested = planSubagents(requests, hunkUnits, hunkInventory, 3).units;
	const brief = { questions, marks: marks(['Q2'], ['unit-1/correctness']) };

	const filled = planBrief(brief, 3 - requested.length, requested);

	expect(filled.map((unit) => [unit.id, unit.reason.split('\n')[0]])).toEqual([
		['subagent-3', 'Brief question Q2, marked unsettled by 1 reviewer.']
	]);

	expect(planBrief(brief, 0, requested)).toEqual([]);
});

test('a question an explicit request already covers is not planned twice', () => {
	const requested = planSubagents([ask('unit-1', 'Does Q1 hold?', 'src/a.ts')], hunkUnits, hunkInventory, 4).units;

	const units = planBrief({ questions: [question('Q1', 2), question('Q2', 52)] }, 3, requested);

	expect(units.map((unit) => unit.reason.split('\n')[0])).toEqual(['Brief question Q2, no reviewer reported on it.']);
});

test('a mark for a question the unit was not shown is dropped, and a repeat mark counts once', () => {
	const kept: ReturnType<typeof marks> = [];
	const shown = [question('Q1', 2)];

	recordUnsettled(kept, 'unit-1/correctness', ['Q1', 'Q9', 'Q1'], shown);
	recordUnsettled(kept, 'unit-1/correctness', ['Q1'], shown);

	expect(kept).toEqual([{ questionId: 'Q1', unitId: 'unit-1/correctness' }]);
});

test('an answer for a question the unit was not shown is dropped, and a repeat answer counts once', () => {
	const kept: ReturnType<typeof answers> = [];
	const shown = [question('Q1', 2)];
	const answer = (questionId: string, outcome: 'confirmed' | 'disproved') => ({ questionId, outcome, note: 'n' });

	recordAnswered(kept, 'unit-1/correctness', [answer('Q1', 'disproved'), answer('Q9', 'disproved')], shown);
	recordAnswered(kept, 'unit-1/correctness', [answer('Q1', 'confirmed')], shown);

	expect(kept).toEqual([{ questionId: 'Q1', unitId: 'unit-1/correctness', outcome: 'disproved' }]);
});

test('a saved state from before unsettled marks and answers existed restores with empty lists', () => {
	const old = { requests: [], units: null, dropped: [] };

	expect(restoreSubagentState(old)).toEqual({
		requests: [],
		unsettled: [],
		answered: [],
		units: null,
		dropped: []
	});

	expect(restoreSubagentState(undefined).answered).toEqual([]);
});
