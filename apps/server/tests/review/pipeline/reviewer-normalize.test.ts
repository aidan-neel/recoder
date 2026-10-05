import { expect, test } from 'bun:test';
import { isLooping } from '../../../src/review/pipeline/agent-loop';
import {
	parseReviewerOutput,
	reviewerValidationError,
	salvageReviewerOutput
} from '../../../src/review/pipeline/reviewer';

test('repairs formatting slips in an attempted final answer', () => {
	const out = parseReviewerOutput({
		message: 'One issue.',
		findings: [
			{
				path: 'a.py',
				line: '42',
				severity: 'Critical',
				description: 'Responses go to the wrong queue.',
				trigger: 'A status reply arrives',
				executionPath: ['a.py:42 routes it', { path: 'a.py', line: '50' }, 'no line here'],
				consequence: 'The caller waits forever',
				expected: 'Replies go back to the sender',
				ruleId: 'r3',
				smell: 'Magic Value'
			}
		]
	});

	expect(out?.findings[0]).toMatchObject({
		file: 'a.py',
		line: 42,
		severity: 'high',
		body: 'Responses go to the wrong queue.',
		category: 'correctness',
		ruleId: 'R3',
		smell: 'magic-value',
		claim: {
			trigger: 'A status reply arrives',
			executionPath: [
				{ file: 'a.py', line: 42, note: 'routes it' },
				{ file: 'a.py', line: 50 }
			],
			consequence: 'The caller waits forever',
			violatedContract: 'Replies go back to the sender'
		}
	});

	expect(out?.examinedHunks).toEqual([]);
});

test('a finding without a category takes the lens’s first one, and an unknown smell is left for the validator', () => {
	const out = parseReviewerOutput(
		{
			findings: [
				{
					file: 'a.ts',
					severity: 'low',
					body: 'b',
					smell: 'vibes',
					claim: { trigger: 't', consequence: 'c', violatedContract: 'v' }
				}
			],
			examinedHunks: []
		},
		'readability'
	);

	expect(out?.findings[0]).toMatchObject({ category: 'readability', smell: null });
});

test('commentary alone is still not a finished review, and errors name the field', () => {
	expect(parseReviewerOutput({ message: 'Let me gather evidence.' })).toBeNull();

	expect(
		reviewerValidationError({ message: 'x', findings: [{ file: 'a.py', severity: 'bogus', body: 'b' }] })
	).toContain('findings.0.severity');
});

test('detects reasoning that goes in circles', () => {
	const loop = 'Let me read the file and search for references. '.repeat(120);

	expect(isLooping(loop)).toBe(true);
	expect(isLooping('a'.repeat(100) + Array.from({ length: 400 }, (_, i) => `step ${i} `).join(''))).toBe(false);
});

test('one malformed finding does not cost the valid ones beside it', () => {
	const claim = { trigger: 't', consequence: 'c', violatedContract: 'v' };

	const raw = {
		message: 'Two issues.',
		findings: [
			{ file: 'a.ts', line: 3, severity: 'high', body: 'Real bug.', claim },
			{ file: 'a.ts', severity: 'bogus', body: 'Broken.' }
		],
		examinedHunks: []
	};

	expect(parseReviewerOutput(raw)).toBeNull();
	expect(salvageReviewerOutput(raw)?.findings.map((finding) => finding.body)).toEqual(['Real bug.']);
	expect(salvageReviewerOutput({ ...raw, findings: raw.findings.slice(1) })).toBeNull();
	expect(salvageReviewerOutput({ message: 'Let me gather evidence.' })).toBeNull();
});

test('an answer without unsettled still parses and salvages, and only brief question ids are kept', () => {
	const claim = { trigger: 't', consequence: 'c', violatedContract: 'v' };
	const good = { file: 'a.ts', line: 3, severity: 'high', body: 'Real bug.', claim };
	const bare = { message: 'Fine.', findings: [], examinedHunks: [] };

	expect(parseReviewerOutput(bare)?.unsettled).toEqual([]);

	expect(
		salvageReviewerOutput({ ...bare, findings: [good, { file: 'a.ts', severity: 'bogus', body: 'b' }] })?.unsettled
	).toEqual([]);

	expect(parseReviewerOutput({ ...bare, unsettled: ['q3', ' Q3 ', 'nope', 7, 'Q10'] })?.unsettled).toEqual([
		'Q3',
		'Q10'
	]);

	expect(parseReviewerOutput({ ...bare, unsettled: 'Q3' })?.unsettled).toEqual([]);
});

test('answered keeps well-formed brief question outcomes, once per question, and drops the rest', () => {
	const bare = { message: 'Fine.', findings: [], examinedHunks: [] };

	expect(parseReviewerOutput(bare)?.answered).toEqual([]);

	const answered = [
		{ questionId: ' q3 ', outcome: 'Disproved', note: 'Guarded by the caller.' },
		{ id: 'Q4', outcome: 'confirmed' },
		{ questionId: 'Q3', outcome: 'confirmed', note: 'again' },
		{ questionId: 'Q5', outcome: 'maybe', note: 'x' },
		{ questionId: 'nope', outcome: 'confirmed', note: 'x' },
		'Q6'
	];

	expect(parseReviewerOutput({ ...bare, answered })?.answered).toEqual([
		{ questionId: 'Q3', outcome: 'disproved', note: 'Guarded by the caller.' },
		{ questionId: 'Q4', outcome: 'confirmed', note: '' }
	]);

	expect(parseReviewerOutput({ ...bare, answered: 'Q3' })?.answered).toEqual([]);
});
