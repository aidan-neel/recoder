import { AsyncLocalStorage } from 'node:async_hooks';

export class PersistenceQueue {
	private pending: Promise<unknown> = Promise.resolve();

	/** Failures stay on the pending chain for drain; the rejection observer prevents an unhandled rejection before that boundary awaits it. */
	push(write: () => Promise<unknown>): void {
		const context = AsyncLocalStorage.snapshot();

		this.pending = this.pending.then(() => context(write));
		this.pending.catch(() => undefined);
	}

	async drain(): Promise<void> {
		let observed: Promise<unknown>;
		let failure: { error: unknown } | undefined;

		do {
			observed = this.pending;

			try {
				await observed;
			} catch (error) {
				failure ??= { error };
			}
		} while (observed !== this.pending);

		if (this.pending === observed) this.pending = Promise.resolve();
		if (failure) throw failure.error;
	}
}

class PersistenceQueues {
	private readonly queues = new Map<string, PersistenceQueue>();

	for(id: string): PersistenceQueue {
		let queue = this.queues.get(id);

		if (!queue) {
			queue = new PersistenceQueue();
			this.queues.set(id, queue);
		}

		return queue;
	}

	async drain(id: string): Promise<void> {
		await this.queues.get(id)?.drain();
	}

	async drainAll(): Promise<void> {
		await Promise.all([...this.queues.values()].map((queue) => queue.drain()));
	}

	delete(id: string): void {
		this.queues.delete(id);
	}
}

export const progressWrites = new PersistenceQueues();
export const metricWrites = new PersistenceQueues();
