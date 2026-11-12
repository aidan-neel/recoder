import { expect, test } from 'bun:test';
import { startReviewWorkers } from '../../../src/review/runtime/worker';

/** A coordinator with no review waiting that counts how often a worker asks for one. */
function emptyQueue() {
	const asked = { claims: 0 };

	const coordinator = {
		claim: async () => {
			asked.claims++;

			return null;
		},
		renew: async () => true,
		release: async () => undefined,
		enqueue: async () => undefined
	};

	return { asked, coordinator };
}

const OPTIONS = { ownerId: 'replica-a', leaseMs: 30_000, pollMs: 250 };

test('a replica with job concurrency 0 never claims a review', async () => {
	const { asked, coordinator } = emptyQueue();
	const stop = startReviewWorkers(coordinator, { ...OPTIONS, concurrency: 0 }, async () => undefined);

	await stop();

	expect(asked.claims).toBe(0);
});

test('a replica with job concurrency asks for a review as soon as it starts', async () => {
	const { asked, coordinator } = emptyQueue();
	const stop = startReviewWorkers(coordinator, { ...OPTIONS, concurrency: 1 }, async () => undefined);

	await stop();

	expect(asked.claims).toBe(1);
});
