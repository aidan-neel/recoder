import { describe, expect, test } from 'bun:test';
import { LENSES } from '../../../../src/review/pipeline/lenses/lenses';
import type { LensId } from '../../../../src/review/pipeline/lenses/types';
import type { ReviewUnit } from '../../../../src/review/pipeline/units';
import {
	planSpecialists,
	type Coordination,
	type DispatchDecision
} from '../../../../src/review/pipeline/variants/specialist-plan';

const EVERY_LENS = LENSES.map((lens) => lens.id);

/** A reviewer slice of one file that `lenses` fit. */
function slice(id: string, path: string, lenses: LensId[] = EVERY_LENS): ReviewUnit {
	return { id, title: path, reason: '', scope: [{ path, hunkIds: [`${path}:1`] }], lenses };
}

const CODE = [slice('reviewer-1', 'src/a.ts'), slice('reviewer-2', 'src/b.ts')];

/** A coordination that dispatches every kept specialist over both code slices, and `extra` besides. */
function coordination(extra: Partial<Coordination> = {}): Coordination {
	const kept = ['correctness', 'security', 'concurrency', 'api-contract', 'rules'];

	return {
		dispatches: [
			...kept.map((specialist) => ({ specialist, slices: ['reviewer-1', 'reviewer-2'], question: '' })),
			...(extra.dispatches ?? [])
		],
		omitted: extra.omitted ?? []
	};
}

function decisionOf(decisions: DispatchDecision[], specialist: LensId): DispatchDecision | undefined {
	return decisions.find((decision) => decision.specialist === specialist);
}

describe('kept specialists', () => {
	test('a kept specialist the coordinator omits still reads every slice it fits, with the omission recorded', () => {
		const plan = planSpecialists(CODE, {
			coordination: {
				dispatches: [],
				omitted: [{ specialist: 'security', reason: 'no input handling' }]
			}
		});

		const security = decisionOf(plan.decisions, 'security');

		expect(security?.outcome).toBe('kept');
		expect(security?.slices).toEqual(['reviewer-1', 'reviewer-2']);
		expect(security?.reason).toContain('no input handling');
	});

	test('a kept specialist given only one slice is widened to every slice it fits', () => {
		const plan = planSpecialists(CODE, {
			coordination: { dispatches: [{ specialist: 'correctness', slices: ['reviewer-2'], question: '' }], omitted: [] }
		});

		const unit = plan.units.find((entry) => entry.id === 'specialist-correctness');

		expect(unit?.scope.map((entry) => entry.path)).toEqual(['src/a.ts', 'src/b.ts']);
	});
});

describe('optional specialists', () => {
	test('one the coordinator omits gets no reviewer, and each slice it fits is left unassigned with the reason', () => {
		const plan = planSpecialists(CODE, {
			coordination: coordination({ omitted: [{ specialist: 'performance', reason: 'no loops' }] })
		});

		expect(plan.units.map((unit) => unit.id)).not.toContain('specialist-performance');
		expect(decisionOf(plan.decisions, 'performance')?.outcome).toBe('omitted');

		expect(plan.unassigned.filter((task) => task.specialist === 'performance')).toEqual([
			{ specialist: 'performance', slice: 'reviewer-1', reason: 'The coordinator omitted it: no loops.' },
			{ specialist: 'performance', slice: 'reviewer-2', reason: 'The coordinator omitted it: no loops.' }
		]);
	});

	test('one dispatched to one slice reads only that slice and carries its question', () => {
		const plan = planSpecialists(CODE, {
			coordination: coordination({
				dispatches: [{ specialist: 'performance', slices: ['reviewer-2'], question: 'Is the loop quadratic?' }]
			})
		});

		const unit = plan.units.find((entry) => entry.id === 'specialist-performance');

		expect(unit?.scope).toEqual([{ path: 'src/b.ts', hunkIds: ['src/b.ts:1'] }]);
		expect(unit?.lenses).toEqual(['performance']);
		expect(unit?.reason).toContain('Is the loop quadratic?');
		expect(plan.unassigned).toContainEqual(expect.objectContaining({ specialist: 'performance', slice: 'reviewer-1' }));
	});

	test('specialists and slices that do not exist or do not fit are ignored', () => {
		const docs = slice('reviewer-1', 'docs/guide.md', ['rules', 'readability']);

		const plan = planSpecialists([docs], {
			coordination: {
				dispatches: [
					{ specialist: 'wizard', slices: ['reviewer-1'], question: '' },
					{ specialist: 'performance', slices: ['reviewer-1'], question: '' },
					{ specialist: 'readability', slices: ['reviewer-9'], question: '' }
				],
				omitted: []
			}
		});

		expect(plan.units.map((unit) => unit.id)).toEqual(['specialist-rules']);
	});
});

describe('a plan the coordinator could not make', () => {
	test('without a plan every specialist reads every slice it fits', () => {
		const plan = planSpecialists(CODE, { failure: 'the model call timed out' });

		expect(plan.units.map((unit) => unit.id)).toEqual(EVERY_LENS.map((id) => `specialist-${id}`));
		expect(plan.decisions.every((decision) => decision.outcome === 'kept')).toBe(true);
		expect(plan.unassigned).toEqual([]);
	});
});

test('a slice no planned specialist reads goes to the first specialist that fits it', () => {
	const selected = [slice('reviewer-1', 'src/a.ts', ['performance', 'readability'])];

	const plan = planSpecialists(selected, { coordination: { dispatches: [], omitted: [] } });

	expect(plan.units.map((unit) => unit.id)).toEqual(['specialist-performance']);
	expect(plan.unassigned).toEqual([expect.objectContaining({ specialist: 'readability', slice: 'reviewer-1' })]);
});
