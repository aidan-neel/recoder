import { expect, test } from 'bun:test';
import { splitCategoryTag } from '../src/findings';
import { reviewListItem, reviewTally, type ReviewListItem } from '../src/review-list';

test('review-list payloads load legacy tiers and use explicit tiers rather than stale severity for attention', () => {
	const review = {
		findings: [
			{ id: 'note', severity: 'error', tier: 'fyi' },
			{ id: 'legacy', severity: 'warning' },
			{ id: 'legacy-low', severity: 'info' }
		]
	} as ReviewListItem;

	const item = reviewListItem(review);

	expect(item.findings.map((f) => f.tier)).toEqual(['fyi', 'warning', 'warning']);
	expect(reviewTally({ ...item, findings: item.findings.slice(2) }, {}).tone).toBe('medium');
	expect(reviewTally({ ...item, findings: item.findings.slice(0, 1) }, {}).tone).toBe('low');
});

test('a leading category tag is split from the message body', () => {
	expect(splitCategoryTag('[security] Any caller can\n name another tenant.')).toEqual({
		tag: 'security',
		body: 'Any caller can\n name another tenant.'
	});
});

test('a message without a leading tag is all body', () => {
	expect(splitCategoryTag('Reads `[0]` of an empty list.')).toEqual({ body: 'Reads `[0]` of an empty list.' });
	expect(splitCategoryTag('')).toEqual({ body: '' });
});
