import { expect, test } from 'bun:test';
import { parseReviewerOutput } from '../../../src/review/pipeline/reviewer';
import { reviewerFindingSchema } from '../../../src/review/pipeline/finding-schema';

const finding = {
	file: 'a.ts',
	line: 1,
	category: 'correctness',
	body: 'Observed behavior.',
	claim: { trigger: 'input', executionPath: [], consequence: 'output', violatedContract: 'contract' }
};

test.each([
	['bug', 'bug'],
	['warning', 'warning'],
	['fyi', 'fyi'],
	['high', 'bug'],
	['medium', 'warning'],
	['low', 'fyi'],
	['info', 'fyi'],
	['Error', 'bug'],
	['Informational', 'fyi']
] as const)('retains and normalizes model tier or severity %s as %s', (value, tier) => {
	const key = ['bug', 'warning', 'fyi'].includes(value) ? 'tier' : 'severity';
	const parsed = parseReviewerOutput({ findings: [{ ...finding, [key]: value }], examinedHunks: [] });

	expect(parsed?.findings).toHaveLength(1);
	expect(parsed?.findings[0].tier).toBe(tier);
});

test('explicit model tiers override stale severity aliases', () => {
	expect(reviewerFindingSchema.parse({ ...finding, tier: 'warning', severity: 'high' }).tier).toBe('warning');
});

test('an unknown explicit tier is not silently replaced by a stale severity alias', () => {
	expect(
		parseReviewerOutput({ findings: [{ ...finding, tier: 'criticalish', severity: 'high' }], examinedHunks: [] })
	).toBeNull();
});

test('FYI does not need an invented defect claim, but bugs and warnings still do', () => {
	const { claim: _claim, ...observation } = finding;
	const output = (tier: string) => parseReviewerOutput({ findings: [{ ...observation, tier }], examinedHunks: [] });

	expect(output('fyi')?.findings[0].tier).toBe('fyi');
	expect(output('bug')).toBeNull();
	expect(output('warning')).toBeNull();
});
