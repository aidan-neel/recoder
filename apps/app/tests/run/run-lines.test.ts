import { describe, expect, test } from 'bun:test';
import { emptyReviewProgress, type ReviewTask } from '@recoder/shared';

import { claimLines, claimState } from '../../src/lib/run/run-lines';

function claim(
	id: string,
	status: ReviewTask['status'],
	message: string,
	updatedAt = '2026-01-01T00:00:00.000Z'
): ReviewTask {
	return { id, label: `Verify: Claim ${id}`, status, message, updatedAt, kind: 'verification' };
}

function progressOf(tasks: ReviewTask[]) {
	return { ...emptyReviewProgress('rv1'), tasks: Object.fromEntries(tasks.map((task) => [task.id, task])) };
}

describe('claimState', () => {
	test('a running verifier reproduces when it runs code and traces when it reads', () => {
		expect(claimState({ status: 'running', message: 'Reproducing the finding, second attempt' })).toBe('reproducing');
		expect(claimState({ status: 'running', message: 'Running code' })).toBe('reproducing');
		expect(claimState({ status: 'running', message: 'Tracing the finding through the code' })).toBe('tracing');
		expect(claimState({ status: 'running', message: 'Reading code' })).toBe('tracing');
		expect(claimState({ status: 'running', message: 'Thinking' })).toBe('checking');
	});

	test('a settled verifier is read from its last word, and an unknown word is only checked', () => {
		expect(claimState({ status: 'done', message: 'Verified by a run' })).toBe('reproduced');
		expect(claimState({ status: 'done', message: 'Traced through the code' })).toBe('traced');
		expect(claimState({ status: 'done', message: 'Checked against the rule' })).toBe('confirmed');
		expect(claimState({ status: 'done', message: 'Verified with "Refill overshoots"' })).toBe('duplicate');
		expect(claimState({ status: 'done', message: 'Covered by #212; dropped' })).toBe('cleared');
		expect(claimState({ status: 'done', message: 'Disproved; dropped' })).toBe('cleared');
		expect(claimState({ status: 'done', message: 'Not run: the code cannot run here' })).toBe('not-run');
		expect(claimState({ status: 'done', message: 'Something new' })).toBe('checked');
		expect(claimState({ status: 'partial', message: 'Could not verify' })).toBe('unsettled');
		expect(claimState({ status: 'waiting', message: 'Waiting for a model' })).toBe('waiting');
	});
});

describe('claimLines', () => {
	test('lists what was found, then what is at work, then the newest cleared, and sums up the rest', () => {
		const { lines, rest, found } = claimLines(
			progressOf([
				claim('old', 'done', 'Disproved; dropped', '2026-01-01T00:00:01.000Z'),
				claim('work', 'running', 'Running code'),
				claim('new', 'done', 'Disproved; dropped', '2026-01-01T00:00:09.000Z'),
				claim('bug', 'done', 'Verified by a run'),
				claim('copy', 'done', 'Verified with "Claim bug"', '2026-01-01T00:00:05.000Z'),
				claim('next', 'queued', 'Queued')
			])
		);

		expect(lines.map((line) => `${line.title}: ${line.word}`)).toEqual([
			'Claim bug: Reproduced',
			'Claim work: Reproducing',
			'Claim new: Cleared',
			'Claim copy: Same as another'
		]);

		expect(rest).toBe('1 more cleared · 1 waiting');
		expect(found).toBe(1);
	});
});
