import { expect, test } from 'bun:test';
import {
	admitCommand,
	priorityPrefix,
	resolveLimits,
	SlotPool,
	trackSandboxWait,
	waitForMemory,
	type MemoryGate
} from '../../src/sandbox/host-load';

const tools = { choom: '/bin/choom', taskset: '/bin/taskset', nice: '/bin/nice', ionice: '/bin/ionice' };

/** A memory gate that polls fast and reads from `free`, so tests finish in milliseconds. */
function gate(free: () => number | null, maxWaitMs = 1_000): MemoryGate {
	return { readAvailableMb: free, minFreeMb: 1536, maxWaitMs, pollMs: 5 };
}

/** Lets queued promise callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test('the priority prefix chains all four tools in front of the command and pins the first cpus', () => {
	expect(priorityPrefix(tools, 12)).toEqual([
		'/bin/choom',
		'-n',
		'1000',
		'--',
		'/bin/taskset',
		'-c',
		'0-11',
		'/bin/nice',
		'-n',
		'19',
		'/bin/ionice',
		'-c',
		'2',
		'-n',
		'7'
	]);
});

test('the priority prefix skips tools the host does not have', () => {
	expect(priorityPrefix({ ...tools, choom: null, ionice: undefined }, 4)).toEqual([
		'/bin/taskset',
		'-c',
		'0-3',
		'/bin/nice',
		'-n',
		'19'
	]);

	expect(priorityPrefix({}, 4)).toEqual([]);
});

test('sandboxes leave a quarter of a 16-cpu host free and keep at least one cpu on a tiny host', () => {
	expect(resolveLimits(16).cpus).toBe(12);
	expect(resolveLimits(2).cpus).toBe(1);
	expect(resolveLimits(1).cpus).toBe(1);
});

test('environment variables override the cpu count, slot counts and memory floor', () => {
	const env = {
		RECODER_SANDBOX_CPUS: '4',
		RECODER_SANDBOX_RUNS: '9',
		RECODER_SANDBOX_PREP: '5',
		RECODER_SANDBOX_MIN_FREE_MB: '100'
	};

	expect(resolveLimits(16, env)).toEqual({ cpus: 4, runSlots: 9, prepSlots: 5, minFreeMb: 100 });
	expect(resolveLimits(16, { RECODER_SANDBOX_RUNS: 'lots' }).runSlots).toBe(6);
});

test('a full prep pool does not block the run pool', async () => {
	const prep = new SlotPool(1);
	const run = new SlotPool(1);

	await prep.acquire();

	void prep.acquire();

	const release = await Promise.race([run.acquire(), settle().then(() => 'blocked')]);

	expect(typeof release).toBe('function');
	expect(prep.waiting).toBe(1);
});

test('waiters are granted slots in the order they asked', async () => {
	const pool = new SlotPool(1);
	const order: number[] = [];
	const first = (await pool.acquire())!;

	const waiters = [1, 2, 3].map((id) =>
		pool.acquire().then((release) => {
			order.push(id);
			release!();
		})
	);

	first();
	await Promise.all(waiters);

	expect(order).toEqual([1, 2, 3]);
});

test('an aborted waiter leaves the queue and does not take a slot', async () => {
	const pool = new SlotPool(1);
	const first = (await pool.acquire())!;
	const controller = new AbortController();
	const aborted = pool.acquire(controller.signal);
	const next = pool.acquire();

	controller.abort();

	expect(await aborted).toBeNull();
	expect(pool.waiting).toBe(1);

	first();

	expect(typeof (await next)).toBe('function');
});

test('a command that is already aborted never takes a slot', async () => {
	const pool = new SlotPool(1);

	expect(await pool.acquire(AbortSignal.abort())).toBeNull();
	expect(typeof (await pool.acquire())).toBe('function');
});

test('releasing a slot twice does not hand out an extra one', async () => {
	const pool = new SlotPool(1);
	const release = (await pool.acquire())!;

	release();
	release();

	await pool.acquire();

	expect(await Promise.race([pool.acquire(), settle().then(() => 'blocked')])).toBe('blocked');
});

test('the memory gate waits while memory is low and goes once it recovers', async () => {
	let free = 200;
	const started = Date.now();

	setTimeout(() => (free = 4_000), 60);

	expect(await waitForMemory(gate(() => free))).toBe(true);
	expect(Date.now() - started).toBeGreaterThanOrEqual(50);
});

test('the memory gate lets the command go after the maximum wait even when memory stays low', async () => {
	const started = Date.now();

	expect(await waitForMemory(gate(() => 200, 60))).toBe(true);
	expect(Date.now() - started).toBeGreaterThanOrEqual(55);
	expect(Date.now() - started).toBeLessThan(500);
});

test('the memory gate stops waiting when the command is aborted', async () => {
	const controller = new AbortController();

	setTimeout(() => controller.abort(), 30);

	expect(
		await waitForMemory(
			gate(() => 200),
			controller.signal
		)
	).toBe(false);
});

test('the memory gate passes when the host reports no memory figure', async () => {
	expect(await waitForMemory(gate(() => null))).toBe(true);
});

test('time a command spends queued for a slot is added to its wait meter', async () => {
	const state = { pools: { prep: new SlotPool(1), run: new SlotPool(1) }, gate: gate(() => null) };
	const holder = await admitCommand('prep', undefined, state);
	const meter = { waitedMs: 0 };
	const queued = trackSandboxWait(meter, () => admitCommand('prep', undefined, state));

	await Bun.sleep(50);
	holder?.();
	(await queued)?.();

	expect(meter.waitedMs).toBeGreaterThanOrEqual(45);
});
