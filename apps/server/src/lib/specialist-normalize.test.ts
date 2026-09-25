import { expect, test } from 'bun:test';
import { isLooping } from './agent-loop';
import { parseSpecialistOutput, specialistValidationError } from './specialist';

test('repairs formatting slips in an attempted final answer', () => {
	const out = parseSpecialistOutput({
		message: 'One issue.',
		findings: [{ path: 'a.py', line: '42', severity: 'Critical', description: 'Responses go to the wrong queue.' }]
	});
	expect(out?.findings[0]).toMatchObject({ file: 'a.py', line: 42, severity: 'high', body: 'Responses go to the wrong queue.', category: 'correctness' });
	expect(out?.examinedHunks).toEqual([]);
});

test('commentary alone is still not a finished review, and errors name the field', () => {
	expect(parseSpecialistOutput({ message: 'Let me gather evidence.' })).toBeNull();
	expect(specialistValidationError({ message: 'x', findings: [{ file: 'a.py', severity: 'bogus', body: 'b' }] })).toContain('findings.0.severity');
});

test('detects reasoning that goes in circles', () => {
	const loop = 'Let me read the file and search for references. '.repeat(120);
	expect(isLooping(loop)).toBe(true);
	expect(isLooping('a'.repeat(100) + Array.from({ length: 400 }, (_, i) => `step ${i} `).join(''))).toBe(false);
});
