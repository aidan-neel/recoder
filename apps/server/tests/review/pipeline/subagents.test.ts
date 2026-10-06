import { expect, test } from 'bun:test';
import type { BriefQuestion } from '@recoder/shared';
import type { CodeClaim } from '../../../src/review/pipeline/intent/types';
import { buildInventory } from '../../../src/review/pipeline/inventory';
import {
	planBriefSubagents,
	planSubagents,
	restoreSubagentState,
	type BriefPlanInput,
	type UnitRequest
} from '../../../src/review/pipeline/subagents';
import { partitionUnits } from '../../../src/review/pipeline/units';
import { TWO_UNIT_DIFF } from './harness-fixtures';
import { TRACE, answer, candidate, question, recorded, reply } from './question-fixtures';

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

/** The stored questions after each lens in `by` left every question in `ids` unresolved. */
function leftOpen(questions: CodeClaim[], by: string[]): BriefQuestion[] {
	return recorded(...by.map((owner) => reply(owner, questions, { unsettled: questions.map(({ id }) => id) })));
}

/** Plans brief subagents over the two-hunk file with `room` left. */
function planBriefFull(
	brief: Partial<BriefPlanInput>,
	room = 4,
	requested: ReturnType<typeof planSubagents>['units'] = []
) {
	return planBriefSubagents(
		{ questions: [], records: [], candidates: [], ...brief },
		requested,
		hunkUnits,
		hunkInventory,
		room
	);
}

/** The subagents `planBriefFull` picks, unsettled ones first. */
function planBrief(...args: Parameters<typeof planBriefFull>) {
	const plan = planBriefFull(...args);

	return [...plan.unsettled, ...plan.unaddressed];
}

test('an unsettled question becomes a subagent that carries the question and its hunk', () => {
	const q1 = question('Q1', 2, 'Does render() still accept old?');
	const [unit] = planBrief({ questions: [q1], records: leftOpen([q1], ['unit-1/correctness']) });

	expect(unit.id).toBe('subagent-1');
	expect(unit.scope).toEqual([{ path: 'src/a.ts', hunkIds: [firstHunk] }]);
	expect(unit.reason).toContain('Q1');
	expect(unit.reason).toContain('marked unsettled by 1 reviewer');
	expect(unit.reason).toContain('Does render() still accept old?');
});

test('a question marked by two lenses is planned before one marked by one', () => {
	const [q1, q2, q3] = [question('Q1', 2), question('Q2', 52), question('Q3', 52)];

	const records = recorded(
		reply('unit-1/correctness', [q1, q3], { unsettled: ['Q1', 'Q3'] }),
		reply('unit-1/security', [q3], { unsettled: ['Q3'] })
	);

	const units = planBrief({ questions: [q1, q2, q3], records });

	expect(units.map((unit) => unit.reason.split('\n')[0])).toEqual([
		'Brief question Q3, marked unsettled by 2 reviewers.',
		'Brief question Q1, marked unsettled by 1 reviewer.',
		'Brief question Q2, no reviewer reported on it.'
	]);
});

test('an unanswered question gets a subagent even with a finding beside it, and an answered one does not', () => {
	const questions = [question('Q1', 2), question('Q2', 52), question('Q3', 53)];

	const records = recorded(
		reply('unit-1/correctness', questions, {
			answered: [answer('Q1', 'confirmed')],
			findings: [{ questionId: 'Q1', candidate: candidate('c1') }]
		}),
		reply('unit-1/security', questions, {
			answered: [answer('Q3', 'disproved', { note: 'Guarded.', contractEvidence: TRACE })]
		})
	);

	const units = planBrief({ questions, records, candidates: [candidate('c1'), candidate('c2', { line: 52 })] });

	expect(units.map((unit) => [unit.reason.split('\n')[0], unit.scope[0].hunkIds])).toEqual([
		['Brief question Q2, no reviewer reported on it.', [secondHunk]]
	]);
});

test('a question whose confirming finding fell is planned again, as one no reviewer settled', () => {
	const q1 = question('Q1', 2);
	const findings = [{ questionId: 'Q1', candidate: candidate('c1') }];
	const records = recorded(reply('unit-1/correctness', [q1], { answered: [answer('Q1', 'confirmed')], findings }));

	expect(planBrief({ questions: [q1], records, candidates: [candidate('c1')] })).toEqual([]);

	const plan = planBriefFull({ questions: [q1], records, candidates: [candidate('c1', { valid: false })] });

	expect(plan.unaddressed.map((unit) => unit.reason.split('\n')[0])).toEqual([
		'Brief question Q1, no reviewer settled it with evidence.'
	]);

	expect(plan.followUps).toEqual([{ question: q1, unitId: 'subagent-1' }]);
});

/** The stored Q1 once the security lens left it unsettled and the correctness lens answered it with `given`. */
function oneLeftOpen(q1: CodeClaim, given: ReturnType<typeof answer>): BriefQuestion[] {
	return recorded(
		reply('unit-1/security', [q1], { unsettled: ['Q1'] }),
		reply('unit-1/correctness', [q1], { answered: [given] })
	);
}

test('a question one lens answered and another left unsettled stays in the unsettled tier', () => {
	const q1 = question('Q1', 2);
	const records = oneLeftOpen(q1, answer('Q1', 'not-applicable'));

	expect(planBrief({ questions: [q1], records }).map((unit) => unit.reason.split('\n')[0])).toEqual([
		'Brief question Q1, marked unsettled by 1 reviewer.'
	]);
});

test('a supported disproof settles a question another lens left unsettled', () => {
	const q1 = question('Q1', 2);
	const records = oneLeftOpen(q1, answer('Q1', 'disproved', { note: 'Guarded.', contractEvidence: TRACE }));

	expect(planBriefFull({ questions: [q1], records })).toEqual({ unsettled: [], unaddressed: [], followUps: [] });
});

test('questions fill only the room explicit requests leave under the cap, marked ones first', () => {
	const questions = [question('Q1', 2), question('Q2', 52)];
	const requests = [ask('unit-1', 'Callers of parse', 'src/a.ts'), ask('unit-1', 'Error paths', 'src/a.ts')];
	const requested = planSubagents(requests, hunkUnits, hunkInventory, 3).units;
	const brief = { questions, records: leftOpen([questions[1]], ['unit-1/correctness']) };

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

test('an unresolved question receives a follow-up, and one that could not get a subagent records why', () => {
	const [q1, q2] = [question('Q1', 2), question('Q2', 52)];
	const offDiff: CodeClaim = { id: 'Q3', text: 'Does the config still load?', file: 'src/config.ts', line: 4 };
	const requested = planSubagents([ask('unit-1', 'Does Q1 hold?', 'src/a.ts')], hunkUnits, hunkInventory, 4).units;
	const records = leftOpen([q1, q2], ['unit-1/correctness']);

	const plan = planBriefFull({ questions: [q1, q2, offDiff], records }, 0, requested);

	expect(plan.followUps).toEqual([
		{ question: q1, unitId: 'subagent-1' },
		{ question: offDiff, unitId: null, notRun: 'Its file is not among the code reviewed.' },
		{ question: q2, unitId: null, notRun: 'No subagent was left under the cap for it.' }
	]);

	expect(planBriefFull({ questions: [q2], records }, 1).followUps).toEqual([{ question: q2, unitId: 'subagent-1' }]);
});

test('a saved state keeps only its requests, units and dropped requests', () => {
	const old = { requests: [], units: null, dropped: [], unsettled: [{ questionId: 'Q1', unitId: 'u' }], answered: [] };

	expect(restoreSubagentState(old as Parameters<typeof restoreSubagentState>[0])).toEqual({
		requests: [],
		units: null,
		dropped: []
	});

	expect(restoreSubagentState(undefined)).toEqual({ requests: [], units: null, dropped: [] });
});
