import { expect, test } from 'bun:test';
import { reportReviewTask, reviewEventBuffer, clearReviewEvents } from '../../../src/review/session/events';
import { reviewProgress } from '../../../src/store';

test('queued events persist the payload at emission time even when the producer mutates it', async () => {
	const id = crypto.randomUUID();
	const task = { id: 'task', label: 'Original', status: 'running' as const, message: 'Original' };

	reportReviewTask(id, task);
	task.message = 'Changed';

	const events = await reviewEventBuffer(id);

	expect(events[0].message).toBe('Original');
	expect((await reviewProgress.get(id))?.tasks.task.message).toBe('Original');
	await clearReviewEvents(id);
});
