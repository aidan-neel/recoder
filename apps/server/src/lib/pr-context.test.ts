import { expect, test } from 'bun:test';
import { formatPrContext } from './pr-context';

test('formats people, labels and linked issues with their blockers', () => {
	const text = formatPrContext({
		author: 'jpayne',
		reviewers: ['aneel'],
		assignees: [],
		labels: ['runner'],
		milestone: null,
		draft: false,
		issues: [{
			ref: 'ai/ark#446', title: 'Separate queues', state: 'opened', labels: ['bug'], relation: 'closes',
			body: 'Split the OutputQueue.', links: ['is blocked by ai/ark#440 "Queue types" (opened)']
		}]
	});
	expect(text).toContain('Reviewers: aneel');
	expect(text).toContain('Assignees: (none)');
	expect(text).toContain('Linked issue ai/ark#446 (closes, opened): Separate queues');
	expect(text).toContain('  is blocked by ai/ark#440 "Queue types" (opened)');
	expect(text).toContain('    Split the OutputQueue.');
});
