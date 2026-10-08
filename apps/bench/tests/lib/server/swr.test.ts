import { expect, test } from 'bun:test';
import { swr } from '../../../src/lib/server/swr';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => ([resolve, reject] = [yes, no]));

	return { promise, resolve, reject };
}

test('callers that arrive before the first value share one load', async () => {
	let loads = 0;
	const cache = swr(1000, async () => ++loads);

	const values = await Promise.all([cache.read(), cache.read(), cache.read()]);

	expect(values).toEqual([1, 1, 1]);
	expect(loads).toBe(1);
});

test('a stale read returns the old value and starts one refresh', async () => {
	const next = deferred<string>();
	let loads = 0;
	const cache = swr(0, async () => (++loads === 1 ? 'old' : next.promise));

	await cache.read();
	await new Promise((resolve) => setTimeout(resolve, 2));

	expect(cache.read()).toBe('old');
	expect(cache.read()).toBe('old');
	expect(loads).toBe(2);

	next.resolve('new');
	await cache.fresh();

	expect(loads).toBe(2);
	expect(await cache.read()).toBe('new');
});

test('a failed refresh keeps the old value', async () => {
	let loads = 0;

	const cache = swr(0, async () => {
		if (++loads > 1) throw new Error('ssh down');

		return 'kept';
	});

	await cache.read();
	await new Promise((resolve) => setTimeout(resolve, 2));
	expect(cache.read()).toBe('kept');
	await expect(cache.fresh()).rejects.toThrow('ssh down');

	expect(cache.read()).toBe('kept');
});

test('a load that fails with no value is tried again on the next read', async () => {
	let loads = 0;

	const cache = swr(1000, async () => {
		if (++loads === 1) throw new Error('cold failure');

		return 'second';
	});

	await expect(Promise.resolve(cache.read())).rejects.toThrow('cold failure');
	expect(await cache.read()).toBe('second');
});

test('a value older than its expiry is not served', async () => {
	let loads = 0;
	const cache = swr(0, async () => ++loads, 1);

	await cache.read();
	await new Promise((resolve) => setTimeout(resolve, 5));

	expect(await cache.read()).toBe(2);
});
