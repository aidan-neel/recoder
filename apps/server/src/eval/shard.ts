import { byId } from './task-set';

/** `--shard i/n`: this host runs part `index` (1-based) of `count`. */
export interface ShardSpec {
	index: number;
	count: number;
}

/** A `--shard` value as `index/count`, or why it is not one. */
export function parseShard(value: string): ShardSpec | string {
	const match = /^(\d+)\/(\d+)$/.exec(value.trim());
	const index = Number(match?.[1]);
	const count = Number(match?.[2]);

	if (!match || index < 1 || count < 1 || index > count)
		return `--shard is i/n with 1 ≤ i ≤ n, like 1/2; got ${JSON.stringify(value)}.`;

	return { index, count };
}

/**
 * Every shard's tasks, in shard order. The tasks are ordered by codebase, then
 * by id, and cut into `count` runs of consecutive tasks whose sizes differ by
 * at most one, so each shard holds whole codebases but for at most one cut at
 * either end, and a host installs few codebases twice. Each shard keeps the
 * input's order. The same tasks always split alike, whichever host splits them.
 */
export function splitTasks<Task extends { id: string; codebase: string }>(
	tasks: readonly Task[],
	count: number
): Task[][] {
	const ordered = [...tasks].sort((a, b) => byId(a.codebase, b.codebase) || byId(a.id, b.id));
	const size = Math.floor(ordered.length / count);
	const extra = ordered.length % count;
	const shards: Task[][] = [];

	let start = 0;

	for (let shard = 0; shard < count; shard++) {
		const end = start + size + (shard < extra ? 1 : 0);
		const ids = new Set(ordered.slice(start, end).map((task) => task.id));

		shards.push(tasks.filter((task) => ids.has(task.id)));
		start = end;
	}

	return shards;
}

/** This host's tasks under `spec`, refusing a split that leaves it none. */
export function shardTasks<Task extends { id: string; codebase: string }>(
	tasks: readonly Task[],
	spec: ShardSpec
): Task[] {
	if (spec.count > tasks.length)
		throw new Error(
			`--shard ${spec.index}/${spec.count}: ${tasks.length} tasks split into at most ${tasks.length} shards.`
		);

	return splitTasks(tasks, spec.count)[spec.index - 1]!;
}
