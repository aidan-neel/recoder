import { expect, test } from 'bun:test';
import { parseShard, shardTasks, splitTasks } from '../../src/eval/shard';

const tasks = [
	...['hono-1', 'hono-2', 'hono-3', 'hono-10', 'hono-11'].map((id) => ({ id, codebase: 'hono' })),
	...['zod-1', 'zod-2'].map((id) => ({ id, codebase: 'zod' })),
	...['ky-1', 'ky-2', 'ky-3', 'ky-4'].map((id) => ({ id, codebase: 'ky' }))
];

const ids = (shards: { id: string }[][]) => shards.map((shard) => shard.map((task) => task.id));

test('--shard takes i/n with 1 ≤ i ≤ n and names the value it refuses', () => {
	expect(parseShard('2/3')).toEqual({ index: 2, count: 3 });

	for (const value of ['0/2', '3/2', '1/0', '1', 'a/b', '1/2/3', '-1/2'])
		expect(parseShard(value)).toBe(`--shard is i/n with 1 ≤ i ≤ n, like 1/2; got ${JSON.stringify(value)}.`);
});

test('shards cover every task once, balance counts within one, split few codebases and keep the input order', () => {
	for (const count of [1, 2, 3, 4, 11]) {
		const shards = splitTasks(tasks, count);
		const sizes = shards.map((shard) => shard.length);

		expect(ids(shards).flat().sort()).toEqual(tasks.map((task) => task.id).sort());
		expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);

		const placements = new Set(shards.flatMap((shard, index) => shard.map((task) => `${index}/${task.codebase}`)));

		expect(placements.size).toBeLessThanOrEqual(3 + count - 1);
	}

	expect(ids(splitTasks(tasks, 3))).toEqual([
		['hono-1', 'hono-2', 'hono-3', 'hono-10'],
		['hono-11', 'ky-1', 'ky-2', 'ky-3'],
		['zod-1', 'zod-2', 'ky-4']
	]);
});

test('the split depends on the tasks, not the order a host lists them in', () => {
	const reversed = [...tasks].reverse();

	expect(ids(splitTasks(reversed, 3)).map((shard) => shard.sort())).toEqual(
		ids(splitTasks(tasks, 3)).map((shard) => shard.sort())
	);
});

test('a shard past the number of tasks is refused rather than run empty', () => {
	expect(() => shardTasks(tasks.slice(0, 2), { index: 3, count: 3 })).toThrow(
		'--shard 3/3: 2 tasks split into at most 2 shards.'
	);
});
