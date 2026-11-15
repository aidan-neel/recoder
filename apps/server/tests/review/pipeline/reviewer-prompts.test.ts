import { expect, test } from 'bun:test';
import { EvidenceStore } from '../../../src/evidence/evidence';
import { buildInventory } from '../../../src/review/pipeline/inventory';
import {
	reviewerSystemPrompt,
	reviewerUserPrompt,
	type ReviewerPromptContext
} from '../../../src/review/pipeline/reviewer-prompts';
import { qualityVerifierSystemPrompt, qualityVerifierUserPrompt } from '../../../src/review/pipeline/quality-verify';
import { verifierSystemPrompt, verifierUserPrompt } from '../../../src/review/pipeline/verify';
import type { ReviewUnit } from '../../../src/review/pipeline/units';
import { candidate } from './question-fixtures';

/** The number of identical leading characters, before either opening diverges. */
function commonPrefix(a: string, b: string): number {
	let index = 0;

	while (index < Math.min(a.length, b.length) && a[index] === b[index]) index++;

	return index;
}

const inventory = buildInventory('');
const evidence = new EvidenceStore(null, inventory, 1000);

const context: ReviewerPromptContext = {
	directive: { instructions: 'Check the changed contracts.', includeGlobs: [], excludeGlobs: [] },
	pr: {
		title: 'Preserve saved state',
		body: 'Keep state across reconnects.',
		context: 'Linked issue #12',
		inventory,
		repo: null
	},
	intent: {
		summary: 'Preserve saved state across reconnects.',
		goals: [],
		acceptanceCriteria: [],
		statedConstraints: [],
		nonGoals: [],
		priorDecisions: [],
		observedChanges: [],
		openQuestions: [],
		stack: { parent: null, children: [] }
	},
	changeModel: null,
	ledger: null
};

test('reviewer openings of one lens set share all review context before the unit', () => {
	const units: ReviewUnit[] = [
		{
			id: 'a',
			title: 'Code',
			reason: 'Review code',
			scope: [{ path: 'src/a.ts', hunkIds: ['a'] }],
			lenses: ['correctness']
		},
		{
			id: 'b',
			title: 'More code',
			reason: 'Review more code',
			scope: [{ path: 'src/b.ts', hunkIds: ['b'] }],
			lenses: ['correctness']
		}
	];

	const system = reviewerSystemPrompt(false, context.directive, {
		subagents: 4,
		delegate: false
	});

	const openings = units.map(
		(unit, index) =>
			`${system}\n\n${reviewerUserPrompt(unit, { turns: 12 - index, calls: 100 - index }, context, `Declarations ${index}`, 'Unit', 'Shared setup')}`
	);

	const boundary = openings[0].indexOf(`Unit ${units[0].id}:`);

	expect(boundary).toBeGreaterThan(system.length);
	expect(commonPrefix(...(openings as [string, string]))).toBeGreaterThanOrEqual(boundary);
	expect(openings[0].indexOf('Shared setup')).toBeLessThan(boundary);
});

test('verifier openings share intent and setup before different findings and changing call limits', () => {
	const findings = [candidate('a', { message: 'Lost state' }), candidate('b', { message: 'Wrong state' })];
	const notes = { intent: 'Shared PR intent', sharedSetupNotes: 'Shared setup', setupNotes: 'Shared setup' };

	for (const quality of [false, true]) {
		const system = quality ? qualityVerifierSystemPrompt() : verifierSystemPrompt();

		const openings = findings.map((finding, index) => {
			const updated = { ...notes, setupNotes: `Baseline results ${index}` };

			const user = quality
				? qualityVerifierUserPrompt(finding, evidence, updated)
				: verifierUserPrompt(finding, evidence, updated, 8 - index);

			return `${system}\n\n${user}`;
		});

		const boundary = openings[0].indexOf(`${quality ? 'Quality finding' : 'Finding'} ${findings[0].candidateId}`);

		expect(boundary).toBeGreaterThan(system.length);
		expect(commonPrefix(...(openings as [string, string]))).toBeGreaterThanOrEqual(boundary);
		expect(openings[0].indexOf(notes.intent)).toBeLessThan(boundary);
	}
});
