import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';

/**
 * Keeps the machine usable while many reviews run sandboxed commands at once.
 * Every command gets a low priority (so a game or a video call wins), a CPU
 * subset (so some host threads always stay free) and a slot from a shared pool
 * (so the number of commands in flight is bounded across all reviews). None of
 * this is a security boundary; the sandbox itself is bubblewrap.
 */

/**
 * `prep` is the dependency install and baseline checks, `run` is every reviewer
 * and verifier command. They have separate pools so a burst of late-starting
 * reviews cannot starve the commands of reviews that are already reviewing,
 * whose wall clocks keep ticking while they wait. `light` is housekeeping (write
 * a scratch file, delete it): it takes no slot, because waiting in line for
 * a millisecond command would cost more than running it.
 */
export type SandboxTier = 'prep' | 'run' | 'light';

/** Ways the load limits can be tuned, as environment variables. */
type LoadEnv = Record<string, string | undefined>;

/** The resolved limits for this machine. */
interface LoadLimits {
	cpus: number;
	runSlots: number;
	prepSlots: number;
	minFreeMb: number;
}

/** A positive integer from an environment value, or null when it is unset or not one. */
function positiveInt(value: string | undefined): number | null {
	const parsed = Number(value);

	return value !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * CPUs the sandboxes may use: all but a quarter (at least two) of the host's,
 * never fewer than one. `RECODER_SANDBOX_CPUS` overrides the count. The
 * remaining vCPUs stay idle, which leaves their Windows host threads alone on
 * WSL2.
 */
function sandboxCpuCount(total: number, env: LoadEnv = {}): number {
	const override = positiveInt(env.RECODER_SANDBOX_CPUS);

	if (override) return Math.min(override, total);

	return Math.max(1, total - Math.max(2, Math.floor(total / 4)));
}

/** Slot counts and the free-memory floor, from the CPU count and `RECODER_SANDBOX_*` overrides. */
export function resolveLimits(total: number, env: LoadEnv = {}): LoadLimits {
	const cpus = sandboxCpuCount(total, env);

	return {
		cpus,
		runSlots: positiveInt(env.RECODER_SANDBOX_RUNS) ?? Math.max(2, Math.floor(cpus / 2)),
		prepSlots: positiveInt(env.RECODER_SANDBOX_PREP) ?? Math.max(1, Math.floor(cpus / 4)),
		minFreeMb: positiveInt(env.RECODER_SANDBOX_MIN_FREE_MB) ?? 1536
	};
}

/** The priority tools a host may have, by the path `Bun.which` found. */
export interface PriorityTools {
	choom?: string | null;
	taskset?: string | null;
	nice?: string | null;
	ionice?: string | null;
}

/**
 * The argv prefix that lowers a command's priority, skipping any tool the
 * host lacks. Each tool execs the next in place, so the pid Bun spawns and
 * kills is still bubblewrap and `--die-with-parent` still points at Bun.
 * `choom` makes the OOM killer pick sandboxes before the dev server or the
 * user's apps. `taskset` pins them to the first `cpus` CPUs; it also lowers
 * `os.availableParallelism()` inside, so vitest and jest start fewer workers.
 * `ionice` uses the best-effort class: the idle class can starve a package
 * install past its timeout.
 */
export function priorityPrefix(tools: PriorityTools, cpus: number): string[] {
	return [
		...(tools.choom ? [tools.choom, '-n', '1000', '--'] : []),
		...(tools.taskset ? [tools.taskset, '-c', `0-${cpus - 1}`] : []),
		...(tools.nice ? [tools.nice, '-n', '19'] : []),
		...(tools.ionice ? [tools.ionice, '-c', '2', '-n', '7'] : [])
	];
}

/** A pool of identical slots, granted first come, first served. */
export class SlotPool {
	private free: number;
	private readonly waiters: Array<() => void> = [];

	constructor(readonly size: number) {
		this.free = size;
	}

	/** Commands waiting for a slot. */
	get waiting(): number {
		return this.waiters.length;
	}

	/** A release function once a slot is held, or null when `signal` aborted first. */
	acquire(signal?: AbortSignal): Promise<(() => void) | null> {
		if (signal?.aborted) return Promise.resolve(null);

		if (this.free > 0) {
			this.free--;

			return Promise.resolve(this.releaser());
		}

		return new Promise((resolve) => {
			const grant = () => {
				signal?.removeEventListener('abort', leave);
				resolve(this.releaser());
			};

			const leave = () => {
				this.waiters.splice(this.waiters.indexOf(grant), 1);
				resolve(null);
			};

			this.waiters.push(grant);
			signal?.addEventListener('abort', leave, { once: true });
		});
	}

	/** Hands a freed slot straight to the oldest waiter, so a newcomer cannot jump the line. */
	private releaser(): () => void {
		let released = false;

		return () => {
			if (released) return;

			released = true;

			const next = this.waiters.shift();

			if (next) next();
			else this.free++;
		};
	}
}

/** MemAvailable from /proc/meminfo in MB, or null when this host has none. */
function readAvailableMb(): number | null {
	try {
		const match = /^MemAvailable:\s+(\d+) kB/m.exec(readFileSync('/proc/meminfo', 'utf8'));

		return match ? Math.floor(Number(match[1]) / 1024) : null;
	} catch {
		return null;
	}
}

/** How `waitForMemory` reads and waits; every field is replaceable in tests. */
export interface MemoryGate {
	readAvailableMb: () => number | null;
	minFreeMb: number;
	maxWaitMs: number;
	pollMs: number;
}

/**
 * Holds a command back while the host is short on memory, polling until
 * `minFreeMb` is available. After `maxWaitMs` it lets the command go anyway,
 * so the gate can never deadlock; `choom` is the hard protection. Returns
 * false when `signal` aborted while waiting.
 */
export async function waitForMemory(gate: MemoryGate, signal?: AbortSignal): Promise<boolean> {
	const deadline = Date.now() + gate.maxWaitMs;

	for (;;) {
		if (signal?.aborted) return false;

		const free = gate.readAvailableMb();

		if (free === null || free >= gate.minFreeMb || Date.now() >= deadline) return true;

		await sleepOrAbort(gate.pollMs, signal);
	}
}

/** Sleeps `ms`, or less when `signal` aborts. */
function sleepOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', done);
			resolve();
		};

		const timer = setTimeout(done, ms);

		signal?.addEventListener('abort', done, { once: true });
	});
}

/** The host-wide state, built once from the environment on first use. */
interface HostLoad {
	prefix: string[];
	pools: Record<'prep' | 'run', SlotPool>;
	gate: MemoryGate;
}

let host: HostLoad | null = null;

/**
 * Slots apply on every platform. The priority tools are Linux's, so macOS gets
 * no prefix, and /proc/meminfo is Linux's, so the memory gate passes there.
 */
function hostLoad(): HostLoad {
	if (!host) {
		const limits = resolveLimits(availableParallelism(), process.env);
		const linux = process.platform === 'linux';

		host = {
			prefix: linux
				? priorityPrefix(
						{
							choom: Bun.which('choom'),
							taskset: Bun.which('taskset'),
							nice: Bun.which('nice'),
							ionice: Bun.which('ionice')
						},
						limits.cpus
					)
				: [],
			pools: { prep: new SlotPool(limits.prepSlots), run: new SlotPool(limits.runSlots) },
			gate: { readAvailableMb, minFreeMb: limits.minFreeMb, maxWaitMs: 60_000, pollMs: 1_000 }
		};
	}

	return host;
}

/** The argv prefix to put before `bwrap` on this host; empty off Linux. */
export function hostPriorityPrefix(): string[] {
	return hostLoad().prefix;
}

const tierScope = new AsyncLocalStorage<SandboxTier>();

/**
 * Runs `fn` with `tier` as the default for every sandboxed command it starts.
 * The baseline checks go through the evidence layer, which has no tier to pass
 * down; this tags them without threading a parameter through it.
 */
export function withSandboxTier<T>(tier: SandboxTier, fn: () => Promise<T>): Promise<T> {
	return tierScope.run(tier, fn);
}

/** The tier a command runs in: the one asked for, else the enclosing `withSandboxTier`, else `run`. */
export function resolveTier(requested?: SandboxTier): SandboxTier {
	return requested ?? tierScope.getStore() ?? 'run';
}

/** Time the sandbox commands of one caller spent waiting for a slot or for memory. */
export interface WaitMeter {
	waitedMs: number;
}

const waitScope = new AsyncLocalStorage<WaitMeter>();

/** Runs `fn` with every sandbox command's wait added to `meter`, so the caller can give that time back to its budget. */
export function trackSandboxWait<T>(meter: WaitMeter, fn: () => Promise<T>): Promise<T> {
	return waitScope.run(meter, fn);
}

/**
 * Waits for a slot in `tier`'s pool, then for enough free memory, and returns
 * the function that gives the slot back. Null when `signal` aborted while
 * waiting. A command's timeout must start only after this resolves, so time
 * spent in line is never charged to it.
 */
export async function admitCommand(
	tier: SandboxTier,
	signal?: AbortSignal,
	state: Pick<HostLoad, 'pools' | 'gate'> = hostLoad()
): Promise<(() => void) | null> {
	if (tier === 'light') return signal?.aborted ? null : () => {};

	const waitStarted = Date.now();
	const release = await state.pools[tier].acquire(signal);
	const admitted = release !== null && (await waitForMemory(state.gate, signal));
	const meter = waitScope.getStore();

	if (meter) meter.waitedMs += Date.now() - waitStarted;

	if (admitted) return release;

	release?.();

	return null;
}
