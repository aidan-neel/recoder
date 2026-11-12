import { describe, expect, test } from 'bun:test';
import { emptyReviewProgress, type ReviewProgress } from '@recoder/shared';

import { waitingReason } from '../../src/lib/run/run-waiting';

function progress(change: Partial<ReviewProgress>): ReviewProgress {
	return { ...emptyReviewProgress('rv1'), ...change };
}

const QUEUED_TASK = {
	id: 't1',
	label: 't1',
	status: 'queued',
	message: '',
	updatedAt: '',
	queueReason: 'Rate limited'
} as const;

describe('why a queued review waits', () => {
	test('a review in line for a worker counts the reviews ahead of it, not its own place', () => {
		const third = progress({ workerWait: { since: '', position: 3, running: 2 } });
		const next = progress({ workerWait: { since: '', position: 1, running: 2 } });

		expect(waitingReason(third)).toBe('2 reviews ahead, 2 running');
		expect(waitingReason(next)).toBe('Next in line, 2 running');
	});

	test('the place in line wins over a task’s own reason, and no wait falls back to it', () => {
		const tasks = { t1: QUEUED_TASK };

		expect(waitingReason(progress({ tasks, workerWait: { since: '', position: 2, running: 1 } }))).toBe(
			'1 review ahead, 1 running'
		);

		expect(waitingReason(progress({ tasks, workerWait: null }))).toBe('Rate limited');
		expect(waitingReason(null)).toBeNull();
	});
});
