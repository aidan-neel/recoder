import { expect, test } from 'bun:test';
import { clearAllCaches, TtlCache } from './ttl-cache';

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
