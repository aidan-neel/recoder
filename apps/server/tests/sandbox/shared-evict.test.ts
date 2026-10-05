import { afterEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evictSharedInstalls, holdSharedInstall } from '../../src/sandbox/shared-install';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 5);
let current = '';

afterEach(async () => {
	await rm(current, { recursive: true, force: true });
});

/** An install entry as publishing leaves it: a `ready.json` whose mtime is when a review last used it. */
async function entry(root: string, key: string, bytes: number, usedDaysAgo: number): Promise<string> {
	const dir = join(root, 'installs', 'acme__app', key);

	await mkdir(join(dir, 'tree'), { recursive: true });
	await writeFile(join(dir, 'ready.json'), JSON.stringify({ dirs: ['node_modules'], bytes }));

	const used = new Date(NOW - usedDaysAgo * DAY);

	await utimes(join(dir, 'ready.json'), used, used);

	return dir;
}

async function sharedRoot(): Promise<string> {
	current = await mkdtemp(join(tmpdir(), 'recoder-evict-'));

	return current;
}

test('installs unused for longer than the age limit are removed and newer ones stay', async () => {
	const root = await sharedRoot();
	const old = await entry(root, 'old', 10, 9);
	const fresh = await entry(root, 'fresh', 10, 1);

	await evictSharedInstalls(root, { maxAgeMs: 7 * DAY, maxBytes: 1_000 }, NOW);

	expect(existsSync(old)).toBe(false);
	expect(existsSync(fresh)).toBe(true);
});

test('when the total is over the size limit the least recently used installs go first', async () => {
	const root = await sharedRoot();
	const oldest = await entry(root, 'a', 400, 3);
	const middle = await entry(root, 'b', 400, 2);
	const newest = await entry(root, 'c', 400, 1);

	await evictSharedInstalls(root, { maxAgeMs: 30 * DAY, maxBytes: 900 }, NOW);

	expect([oldest, middle, newest].map((dir) => existsSync(dir))).toEqual([false, true, true]);
});

test('an install a running review holds is never removed, however old', async () => {
	const root = await sharedRoot();
	const held = await entry(root, 'held', 500, 40);
	const release = holdSharedInstall(held);

	await evictSharedInstalls(root, { maxAgeMs: 7 * DAY, maxBytes: 1 }, NOW);
	expect(existsSync(held)).toBe(true);

	release();
	await evictSharedInstalls(root, { maxAgeMs: 7 * DAY, maxBytes: 1 }, NOW);
	expect(existsSync(held)).toBe(false);
});

test('an install that is still being published is left alone', async () => {
	const root = await sharedRoot();
	const building = join(root, 'installs', 'acme__app', 'k.tmp-r1');

	await mkdir(building, { recursive: true });
	await evictSharedInstalls(root, { maxAgeMs: 0, maxBytes: 0 }, NOW);

	expect(existsSync(building)).toBe(true);
});
