import { expect, test } from 'bun:test';
import { assignmentCounts, formatAssignmentHeadline } from './progress';

test('assignment headline counts reviewers, not retrieval tasks', () => {
	const counts = assignmentCounts([
		{ id: 'correctness-core', role: 'correctness', title: 'A', reason: '', status: 'running', scope: [] },
		{ id: 'patterns-core', role: 'patterns', title: 'B', reason: '', status: 'queued', scope: [] },
		{ id: 'security-auth', role: 'security', title: 'C', reason: '', status: 'done', scope: [] }
	]);
	expect(counts).toMatchObject({ active: 1, queued: 1, complete: 1, total: 3 });
	expect(formatAssignmentHeadline([
		{ id: 'correctness-core', role: 'correctness', title: 'A', reason: '', status: 'running', scope: [] },
		{ id: 'patterns-core', role: 'patterns', title: 'B', reason: '', status: 'queued', scope: [] },
		{ id: 'security-auth', role: 'security', title: 'C', reason: '', status: 'done', scope: [] }
	])).toBe('1 reviewer active · 1 queued · 1 complete');
});
