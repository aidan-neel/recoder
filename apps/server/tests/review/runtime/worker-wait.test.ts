import { afterEach, expect, test } from 'bun:test';
import type { ReviewStatus } from '@recoder/shared';
import { db, reviewProgress } from '../../../src/store';
import type { WorkerBacklog } from '../../../src/review/runtime/coordinator';
import { createWorkerWaitReporter } from '../../../src/review/runtime/worker-wait';
import { testReview } from '../../helpers/review';

const REQUESTED_AT = new Date('2026-01-01T00:00:00Z');

const ids: string[] = [];

async function review(status: ReviewStatus): Promise<string> {
	const value = testReview({ status });

	ids.push(value.id);
	await db.reviews.set(value);

	return value.id;
}

/** A coordinator whose backlog is whatever the test last put in `backlog.current`. */
function backlogOf(initial: WorkerBacklog) {
	const backlog = { current: initial };

	return { backlog, coordinator: { backlog: async () => backlog.current } };
}

function waiting(reviewId: string, overdue = true) {
	return { reviewId, requestedAt: REQUESTED_AT, overdue };
}

afterEach(async () => {
	for (const id of ids.splice(0)) {
		await db.reviews.delete(id);
		await reviewProgress.delete(id);
	}
});

test('a queued review no worker has taken says it waits for one, with its place in line', async () => {
	const ahead = await review('queued');
	const behind = await review('queued');
	const { coordinator } = backlogOf({ waiting: [waiting(ahead, false), waiting(behind)], running: 2 });

	await createWorkerWaitReporter(coordinator)();

	expect((await reviewProgress.get(behind))?.workerWait).toEqual({
		since: REQUESTED_AT.toISOString(),
		position: 2,
		running: 2
	});
});

test('a review that joined the queue moments ago is not marked as waiting yet', async () => {
	const fresh = await review('queued');
	const { coordinator } = backlogOf({ waiting: [waiting(fresh, false)], running: 0 });

	await createWorkerWaitReporter(coordinator)();

	expect((await reviewProgress.get(fresh))?.workerWait).toBeUndefined();
});

test('a finished review waiting to answer a chat message is not marked as a queued review', async () => {
	const finished = await review('passed');
	const { coordinator } = backlogOf({ waiting: [waiting(finished)], running: 1 });

	await createWorkerWaitReporter(coordinator)();

	expect((await reviewProgress.get(finished))?.workerWait).toBeUndefined();
});

test('a review a worker took no longer says it waits for one', async () => {
	const taken = await review('queued');
	const { backlog, coordinator } = backlogOf({ waiting: [waiting(taken)], running: 1 });
	const report = createWorkerWaitReporter(coordinator);

	await report();
	backlog.current = { waiting: [], running: 2 };
	await report();

	expect((await reviewProgress.get(taken))?.workerWait).toBeNull();
});
