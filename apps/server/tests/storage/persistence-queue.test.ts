import { AsyncLocalStorage } from 'node:async_hooks';
import { expect, test } from 'bun:test';
import { PersistenceQueue } from '../../src/storage/persistence-queue';

test('queued writes finish in submission order and a drain includes writes submitted while it waits', async () => {
	const queue = new PersistenceQueue();
	const values: number[] = [];
	const gate = Promise.withResolvers<void>();

	queue.push(async () => {
		await gate.promise;
		values.push(1);

		queue.push(async () => {
			values.push(3);
		});
	});

	queue.push(async () => {
		values.push(2);
	});

	const drained = queue.drain();

	expect(values).toEqual([]);
	gate.resolve();
	await drained;
	expect(values).toEqual([1, 2, 3]);
});

test('each queued write retains the async owner context that submitted it', async () => {
	const owners = new AsyncLocalStorage<string>();
	const queue = new PersistenceQueue();
	const observed: (string | undefined)[] = [];

	for (const owner of ['first', 'second']) {
		owners.run(owner, () =>
			queue.push(async () => {
				observed.push(owners.getStore());
			})
		);
	}

	await queue.drain();
	expect(observed).toEqual(['first', 'second']);
});

test('a failed write is reported by the drain and prevents later writes from committing', async () => {
	const queue = new PersistenceQueue();
	const failure = new Error('storage unavailable');
	let laterCommitted = false;

	queue.push(async () => {
		throw failure;
	});

	queue.push(async () => {
		laterCommitted = true;
	});

	await expect(queue.drain()).rejects.toBe(failure);
	expect(laterCommitted).toBe(false);
});

test('writes can retry after a drain reports the failed batch', async () => {
	const queue = new PersistenceQueue();
	let saved = false;

	queue.push(async () => {
		throw new Error('temporary outage');
	});

	await expect(queue.drain()).rejects.toThrow('temporary outage');

	queue.push(async () => {
		saved = true;
	});

	await queue.drain();
	expect(saved).toBe(true);
});
