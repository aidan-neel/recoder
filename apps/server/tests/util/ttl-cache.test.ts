import { expect, test } from 'bun:test';
import { clearAllCaches, TtlCache } from '../../src/util/ttl-cache';

test('concurrent callers share one load', async () => {
	const cache = new TtlCache<number>(1000);
	let calls = 0;

	const load = async () => {
		calls++;
		await Bun.sleep(5);

		return 1;
	};

	await Promise.all([cache.get('a', load), cache.get('a', load)]);
	expect(calls).toBe(1);
});

test('a failed load is not cached', async () => {
	const cache = new TtlCache<number>(1000);

	await expect(cache.get('a', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
	expect(await cache.get('a', async () => 2)).toBe(2);
});

test('a load that started before a clear is not stored', async () => {
	const cache = new TtlCache<string>(1000);

	const slow = cache.get('a', async () => {
		await Bun.sleep(10);

		return 'old token';
	});

	clearAllCaches();
	await slow;
	expect(await cache.get('a', async () => 'new token')).toBe('new token');
});

test('entries expire after the ttl', async () => {
	const cache = new TtlCache<number>(5);

	await cache.get('a', async () => 1);
	await Bun.sleep(10);
	expect(await cache.get('a', async () => 2)).toBe(2);
});

test('with a failure time, a failed load is kept and its error served again until it expires', async () => {
	const cache = new TtlCache<number>(1000, 10, 15);
	const refused = new Error('bad credentials');
	let calls = 0;

	const load = async () => {
		calls++;

		throw refused;
	};

	await expect(cache.get('a', load)).rejects.toBe(refused);
	await expect(cache.get('a', load)).rejects.toBe(refused);
	expect(calls).toBe(1);

	await Bun.sleep(20);
	expect(await cache.get('a', async () => 2)).toBe(2);
});

test('a stale value is served at once while a fresh one loads behind it', async () => {
	const cache = new TtlCache<string>(5);
	let release = () => {};

	await cache.stale('a', async () => 'old');
	await Bun.sleep(10);

	const slow = new Promise<string>((resolve) => (release = () => resolve('new')));

	expect(await cache.stale('a', () => slow)).toBe('old');

	release();
	await slow;
	await Bun.sleep(0);
	expect(await cache.stale('a', async () => 'unused')).toBe('new');
});

test('past its size, the cache evicts the key read least recently, not the first one stored', async () => {
	const cache = new TtlCache<string>(1000, 2);
	const loads: string[] = [];

	const load = (key: string) => async () => {
		loads.push(key);

		return key;
	};

	await cache.get('hot', load('hot'));
	await cache.get('cold', load('cold'));
	await cache.get('hot', load('hot'));
	await cache.get('new', load('new'));
	await cache.get('hot', load('hot'));
	await cache.get('cold', load('cold'));

	expect(loads).toEqual(['hot', 'cold', 'new', 'cold']);
});

test('deleting a prefix lets go only of the loads it covers', async () => {
	const cache = new TtlCache<string>(1000);
	const loads: string[] = [];

	const slow = (value: string) => async () => {
		loads.push(value);
		await Bun.sleep(10);

		return value;
	};

	const covered = cache.get('repo-1:pulls', slow('old pulls'));
	const other = cache.get('repo-2:pulls', slow('other pulls'));

	cache.delete('repo-1:');

	expect(await cache.get('repo-2:pulls', slow('joined'))).toBe('other pulls');
	await Promise.all([covered, other]);
	expect(await cache.get('repo-2:pulls', slow('unused'))).toBe('other pulls');
	expect(await cache.get('repo-1:pulls', slow('new pulls'))).toBe('new pulls');
	expect(loads).toEqual(['old pulls', 'other pulls', 'new pulls']);
});
