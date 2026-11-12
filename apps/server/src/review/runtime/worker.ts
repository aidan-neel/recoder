import { setTimeout as delay } from 'node:timers/promises';
import type { PostgresCoordinator } from './coordinator';
import { OwnershipLostError, withLease, type ReviewLease } from './ownership';

interface WorkerOptions {
	ownerId: string;
	/** Reviews this replica runs at once; 0 makes it an API-only replica that never claims a review. */
	concurrency: number;
	leaseMs: number;
	pollMs: number;
}

interface Execution {
	lease: ReviewLease;
	controller: AbortController;
	settled: Promise<void>;
}

export class ReviewWorkerShutdownError extends Error {
	constructor() {
		super('This review server is shutting down. Another server can continue its work.');
		this.name = 'ReviewWorkerShutdownError';
	}
}

async function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
	try {
		await delay(milliseconds, undefined, { signal });
	} catch (error) {
		if (!signal.aborted) throw error;
	}
}

/** What a worker needs from the coordinator: claim a review, keep its lease, and hand it back. */
type ReviewClaims = Pick<PostgresCoordinator, 'claim' | 'renew' | 'release' | 'enqueue'>;

export function startReviewWorkers(
	coordinator: ReviewClaims,
	options: WorkerOptions,
	execute: (lease: ReviewLease, signal: AbortSignal) => Promise<void>
): () => Promise<void> {
	const shutdown = new AbortController();
	const active = new Map<string, Execution>();
	let stopping: Promise<void> | undefined;

	async function release(lease: ReviewLease, requeue: boolean): Promise<void> {
		try {
			await coordinator.release(lease, { requeue });
		} catch (error) {
			if (!(error instanceof OwnershipLostError))
				console.error('[review-worker] could not release review ownership', lease.reviewId);
		}
	}

	async function run(lease: ReviewLease, claimedAt: number, controller: AbortController): Promise<void> {
		const heartbeat = new AbortController();
		let expiresAt = claimedAt + options.leaseMs;
		let expiry: ReturnType<typeof setTimeout> | undefined;
		let failed = false;

		const expire = () => controller.abort(new OwnershipLostError(lease.reviewId));

		const scheduleExpiry = () => {
			clearTimeout(expiry);
			expiry = setTimeout(expire, Math.max(0, expiresAt - performance.now()));
			expiry.unref();
		};

		scheduleExpiry();

		const renew = async () => {
			while (!heartbeat.signal.aborted && !controller.signal.aborted) {
				await wait(Math.max(1, Math.floor(options.leaseMs / 3)), heartbeat.signal);
				if (heartbeat.signal.aborted || controller.signal.aborted) return;

				const started = performance.now();

				try {
					if (!(await coordinator.renew(lease))) {
						expire();

						return;
					}
				} catch {
					expire();

					return;
				}

				if (!controller.signal.aborted) {
					expiresAt = started + options.leaseMs;
					scheduleExpiry();
				}
			}
		};

		void renew().catch(expire);

		try {
			if (performance.now() >= expiresAt) expire();
			if (!controller.signal.aborted) await withLease(lease, () => execute(lease, controller.signal));
		} catch (error) {
			failed = true;
			if (error instanceof OwnershipLostError) controller.abort(error);

			if (!controller.signal.aborted && !(error instanceof OwnershipLostError))
				console.error('[review-worker] review executor failed', lease.reviewId);
		} finally {
			heartbeat.abort();
			clearTimeout(expiry);

			if (failed && !controller.signal.aborted) {
				try {
					await coordinator.enqueue(lease.reviewId);
				} catch {
					console.error('[review-worker] could not reschedule review execution', lease.reviewId);
				}
			}

			await release(lease, failed || controller.signal.aborted);
		}
	}

	async function poll(): Promise<void> {
		while (!shutdown.signal.aborted) {
			try {
				while (active.size < options.concurrency && !shutdown.signal.aborted) {
					const claimedAt = performance.now();
					const lease = await coordinator.claim(options.ownerId);

					if (!lease) break;

					if (shutdown.signal.aborted) {
						await release(lease, true);

						break;
					}

					const previous = active.get(lease.reviewId);

					if (previous) {
						previous.controller.abort(new OwnershipLostError(lease.reviewId));
						await release(lease, true);

						break;
					}

					const controller = new AbortController();
					const settled = run(lease, claimedAt, controller).finally(() => active.delete(lease.reviewId));

					active.set(lease.reviewId, { lease, controller, settled });
				}
			} catch {
				if (!shutdown.signal.aborted) console.error('[review-worker] could not claim review ownership');
			}

			await wait(options.pollMs, shutdown.signal);
		}
	}

	const polling = options.concurrency > 0 ? poll() : Promise.resolve();

	return () => {
		stopping ??= (async () => {
			shutdown.abort();

			for (const execution of active.values()) execution.controller.abort(new ReviewWorkerShutdownError());

			const grace = Math.min(5000, options.leaseMs);
			let timeout: ReturnType<typeof setTimeout> | undefined;

			await Promise.race([
				Promise.all([polling, ...[...active.values()].map((execution) => execution.settled)]),
				new Promise<void>((resolve) => {
					timeout = setTimeout(resolve, grace);
				})
			]);

			clearTimeout(timeout);

			for (const execution of active.values()) void release(execution.lease, true);
		})();

		return stopping;
	};
}
