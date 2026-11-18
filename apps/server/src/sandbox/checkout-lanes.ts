import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { trackBackgroundWork } from '../util/background-work.js';
import { keyedQueue } from '../util/keyed-queue.js';
import { cloneTree } from './clone-tree.js';
import type { SandboxLayout } from './sandbox-layout.js';

/** One agent's private copy of the checkout, as its commands see it. */
export interface Lane {
	/** The layout a command runs under: the copy as its checkout, with the review's own checkout readable. */
	layout: SandboxLayout;
	/** The copy was made for this call, so it holds none of the agent's scratch files yet. */
	fresh: boolean;
}

/** A copy that exists, and the state of the checkout it was made from. */
interface Copy {
	dir: string;
	version: number;
}

/**
 * Whether this host gives each agent a copy of the checkout: macOS, where APFS clones a whole tree in about a
 * third of a second. Elsewhere agents share the one checkout, one command at a time. `RECODER_LANES=off` shares it
 * here too.
 */
export function lanesAvailable(): boolean {
	return process.platform === 'darwin' && process.env.RECODER_LANES !== 'off';
}

/**
 * A review's private copies of its prepared checkout, one per agent, so the commands of different agents run at
 * the same time and nothing one agent writes can reach another. A copy is made the first time its agent runs
 * something, while no command runs in the checkout, and made again when the checkout has changed since
 * ({@link CheckoutLanes.invalidate}). One agent's commands still run one at a time.
 */
export class CheckoutLanes {
	private readonly copies = new Map<string, Copy>();
	private readonly queue = keyedQueue();
	private version = 0;
	private made = 0;
	/** Set when a copy could not be made; every later call shares the checkout rather than try again. */
	private failed = false;

	constructor(
		private readonly checkout: SandboxLayout,
		/** Runs `work` while no command runs in the checkout itself. */
		private readonly whileIdle: <T>(work: () => Promise<T>) => Promise<T>
	) {}

	/**
	 * Runs `work` in `owner`'s copy, after every call the owner queued before it. Undefined when the copy could
	 * not be made, and `work` did not run: the caller shares the checkout.
	 */
	use<T>(owner: string, work: (lane: Lane) => Promise<T>): Promise<T | undefined> {
		return this.queue(owner, async () => {
			const lane = await this.open(owner);

			return lane ? work(lane) : undefined;
		});
	}

	/** The checkout changed (a generation command ran in it), so every copy is made again before its next use. */
	invalidate(): void {
		this.version++;
	}

	/** Deletes `owner`'s copy once the commands it has queued are done; its next command gets a new one. */
	release(owner: string): void {
		void this.queue(owner, async () => this.discard(owner));
	}

	/** Deletes every copy. The files go in the background: a review does not wait on them to report its result. */
	removeAll(): void {
		this.failed = true;

		for (const owner of [...this.copies.keys()]) this.discard(owner);

		trackBackgroundWork(rm(this.checkout.lanesDir, { recursive: true, force: true }));
	}

	private discard(owner: string): void {
		const copy = this.copies.get(owner);

		if (!copy) return;

		this.copies.delete(owner);
		trackBackgroundWork(rm(copy.dir, { recursive: true, force: true }));
	}

	private async open(owner: string): Promise<Lane | null> {
		if (this.failed) return null;

		const current = this.copies.get(owner);

		if (current?.version === this.version) return { layout: this.layoutOf(current.dir), fresh: false };

		this.discard(owner);

		const dir = join(this.checkout.lanesDir, `${owner.replace(/[^\w.-]/g, '_')}-${++this.made}`);

		await mkdir(this.checkout.lanesDir, { recursive: true });

		const version = await this.whileIdle(async () =>
			(await cloneTree(this.checkout.checkout, dir)) ? this.version : null
		);

		if (version === null) {
			this.failed = true;

			return null;
		}

		await refreshIndex(dir);
		this.copies.set(owner, { dir, version });

		return { layout: this.layoutOf(dir), fresh: true };
	}

	/**
	 * The checkout's layout with `dir` in its place. The checkout stays readable, because what an install wrote
	 * there by absolute path (a virtualenv's script headers) still points at it.
	 */
	private layoutOf(dir: string): SandboxLayout {
		const { checkout, env, readOnly } = this.checkout;

		return {
			...this.checkout,
			checkout: dir,
			readOnly: [...(readOnly ?? []), checkout],
			env: {
				...env,
				PATH: env
					.PATH!.split(':')
					.map((entry) => movedInto(entry, checkout, dir))
					.join(':')
			}
		};
	}
}

/** `path` with its leading `from` replaced by `to`, when it is `from` or under it. */
function movedInto(path: string, from: string, to: string): string {
	return path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
}

/**
 * A copy's files have new inode numbers, so git's index calls every one of them changed until it is refreshed:
 * without this each `git status` after a command would read the whole tree again.
 */
async function refreshIndex(dir: string): Promise<void> {
	await Bun.spawn(['git', 'update-index', '-q', '--refresh'], {
		cwd: dir,
		stdin: 'ignore',
		stdout: 'ignore',
		stderr: 'ignore'
	}).exited;
}
