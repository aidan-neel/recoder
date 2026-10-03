import { expect, test } from 'bun:test';
import { isLooping } from '../../../src/review/pipeline/agent-loop';
import { parseReviewerOutput, reviewerValidationError } from '../../../src/review/pipeline/reviewer';

test('repairs formatting slips in an attempted final answer', () => {
	const out = parseReviewerOutput({
		message: 'One issue.',
		findings: [{ path: 'a.py', line: '42', severity: 'Critical', description: 'Responses go to the wrong queue.' }]
	});

	expect(out?.findings[0]).toMatchObject({
		file: 'a.py',
		line: 42,
		severity: 'high',
		body: 'Responses go to the wrong queue.',
		category: 'correctness'
	});

	expect(out?.examinedHunks).toEqual([]);
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
