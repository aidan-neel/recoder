import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { PostgresCoordinator } from '../../src/review/runtime/coordinator';
import { currentLease, OwnershipLostError, type ReviewLease } from '../../src/review/runtime/ownership';
import { ReviewWorkerShutdownError, startReviewWorkers } from '../../src/review/runtime/worker';

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `worker_${crypto.randomUUID().replaceAll('-', '')}`;

async function bounded<T>(promise: Promise<T>): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;

	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(() => reject(new Error('The review worker did not reach the expected state.')), 2000);
			})
		]);
	} finally {
		clearTimeout(timeout);
	}
}

async function until(check: () => Promise<boolean>): Promise<void> {
	const deadline = performance.now() + 2000;

	while (!(await check())) {
		if (performance.now() >= deadline) throw new Error('The review worker did not reach the expected state.');
	}
}

function aborted(signal: AbortSignal): Promise<unknown> {
	if (signal.aborted) return Promise.resolve(signal.reason);

	return new Promise((resolve) => signal.addEventListener('abort', () => resolve(signal.reason), { once: true }));
}

describe.skipIf(!databaseUrl)('Postgres review workers (requires TEST_DATABASE_URL)', () => {
	const url = databaseUrl ?? 'postgres://unused.invalid/disabled';
	const admin = new SQL(url);
	const options = { connection: { search_path: schema, statement_timeout: 5000, lock_timeout: 5000 } };
	const database = new SQL(url, options);
	const peerDatabase = new SQL(url, options);
	const coordinator = new PostgresCoordinator(database, { leaseMs: 300 });
	const peer = new PostgresCoordinator(peerDatabase, { leaseMs: 300 });
	const stops: (() => Promise<void>)[] = [];

	beforeAll(async () => {
		await admin`CREATE SCHEMA ${admin(schema)}`;
		await coordinator.initialize();
	});

	beforeEach(async () => {
		await database`TRUNCATE review_actor_leases, review_actor_commands RESTART IDENTITY CASCADE`;
	});

	afterEach(async () => {
		await Promise.all(stops.splice(0).map((stop) => stop()));
	});

	afterAll(async () => {
		await Promise.all([database.close(), peerDatabase.close()]);
		await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
		await admin.close();
	});

	function start(
		ownerId: string,
		execute: (lease: ReviewLease, signal: AbortSignal) => Promise<void>,
		concurrency = 1
	) {
		const stop = startReviewWorkers(
			ownerId === 'replica-a' ? coordinator : peer,
			{ ownerId, concurrency, leaseMs: 300, pollMs: 5 },
			execute
		);

		stops.push(stop);

		return stop;
	}

	async function expire(reviewId: string): Promise<void> {
		await database`
			UPDATE review_actor_leases SET expires_at = clock_timestamp() - interval '1 second'
			WHERE review_id = ${reviewId}
		`;
	}

	test('one replica executes a review while heartbeat renewal keeps its lease alive', async () => {
		await coordinator.enqueue('review-1');

		const started = Promise.withResolvers<ReviewLease>();
		let executions = 0;

		const execute = async (lease: ReviewLease, signal: AbortSignal) => {
			executions++;
			expect(currentLease()).toEqual(lease);
			started.resolve(lease);
			await aborted(signal);
		};

		start('replica-a', execute);
		start('replica-b', execute);

		const original = await bounded(started.promise);

		await until(async () => {
			const rows = await database<{ later: boolean; alive: boolean; owner: string }[]>`
				SELECT clock_timestamp() > ${original.expiresAt} AS later,
				       expires_at > clock_timestamp() AS alive, owner_id AS owner
				FROM review_actor_leases WHERE review_id = 'review-1'
			`;

			return rows[0]?.later === true && rows[0]?.alive === true && rows[0]?.owner === original.ownerId;
		});

		expect(executions).toBe(1);
	});

	test('an expired executor is aborted and a successor receives a higher ownership epoch', async () => {
		await coordinator.enqueue('review-1');

		const started = Promise.withResolvers<ReviewLease>();
		const lost = Promise.withResolvers<unknown>();
		const cleanup = Promise.withResolvers<void>();
		const successor = Promise.withResolvers<ReviewLease>();

		start('replica-a', async (lease, signal) => {
			started.resolve(lease);
			lost.resolve(await aborted(signal));
			await cleanup.promise;
		});

		const original = await bounded(started.promise);

		await expire(original.reviewId);

		start('replica-b', async (lease, signal) => {
			successor.resolve(lease);
			await aborted(signal);
		});

		try {
			const next = await bounded(successor.promise);

			expect(BigInt(next.epoch)).toBeGreaterThan(BigInt(original.epoch));
			expect(await bounded(lost.promise)).toBeInstanceOf(OwnershipLostError);
		} finally {
			cleanup.resolve();
		}
	});

	test('shutdown aborts with a distinct reason and requeues the review for another server', async () => {
		await coordinator.enqueue('review-1');

		const started = Promise.withResolvers<void>();
		const ended = Promise.withResolvers<unknown>();

		const stop = start('replica-a', async (_lease, signal) => {
			started.resolve();
			ended.resolve(await aborted(signal));
		});

		await bounded(started.promise);
		await stop();
		expect(await ended.promise).toBeInstanceOf(ReviewWorkerShutdownError);
		expect((await peer.claim('replica-b'))?.reviewId).toBe('review-1');
	});

	test('a rejected executor does not prevent the next pending review from running', async () => {
		await coordinator.enqueue('broken');
		await coordinator.enqueue('next');

		const next = Promise.withResolvers<void>();
		let failures = 0;

		start('replica-a', async (lease, signal) => {
			if (lease.reviewId === 'broken') {
				failures++;

				throw new Error('Executor could not start.');
			}

			next.resolve();
			await aborted(signal);
		});

		await bounded(next.promise);
		expect(failures).toBe(1);
	});

	test('shutdown returns even when executor cleanup ignores cancellation', async () => {
		await coordinator.enqueue('review-1');

		const started = Promise.withResolvers<void>();
		const cleanup = Promise.withResolvers<void>();

		const stop = start('replica-a', async () => {
			started.resolve();
			await cleanup.promise;
		});

		try {
			await bounded(started.promise);
			await bounded(stop());
			await until(async () => (await peer.claim('replica-b')) !== null);
		} finally {
			cleanup.resolve();
		}
	});

	test('a local executor drains before the same review starts under its next lease', async () => {
		await coordinator.enqueue('review-1');

		const started = Promise.withResolvers<ReviewLease>();
		const cleanup = Promise.withResolvers<void>();
		const successor = Promise.withResolvers<ReviewLease>();
		let executions = 0;

		start(
			'replica-a',
			async (lease, signal) => {
				executions++;

				if (executions === 1) {
					started.resolve(lease);
					await aborted(signal);
					await cleanup.promise;
				} else {
					successor.resolve(lease);
					await aborted(signal);
				}
			},
			2
		);

		const original = await bounded(started.promise);

		try {
			await expire(original.reviewId);

			await until(async () => {
				const rows = await database<
					{ epoch: string }[]
				>`SELECT epoch::text FROM review_actor_leases WHERE review_id = 'review-1'`;

				return BigInt(rows[0]?.epoch ?? '0') > BigInt(original.epoch);
			});

			expect(executions).toBe(1);
		} finally {
			cleanup.resolve();
		}

		expect(BigInt((await bounded(successor.promise)).epoch)).toBeGreaterThan(BigInt(original.epoch));
	});

	test('a blocked renewal cannot keep an executor alive past its local lease deadline', async () => {
		await coordinator.enqueue('review-1');

		const started = Promise.withResolvers<void>();
		const lost = Promise.withResolvers<unknown>();
		const locked = Promise.withResolvers<void>();
		const unlock = Promise.withResolvers<void>();

		start('replica-a', async (_lease, signal) => {
			started.resolve();
			lost.resolve(await aborted(signal));
		});

		await bounded(started.promise);

		const lock = peerDatabase.begin(async (transaction) => {
			await transaction`SELECT review_id FROM review_actor_leases WHERE review_id = 'review-1' FOR UPDATE`;
			locked.resolve();
			await unlock.promise;
		});

		try {
			await bounded(locked.promise);
			expect(await bounded(lost.promise)).toBeInstanceOf(OwnershipLostError);
		} finally {
			unlock.resolve();
			await lock;
		}
	});

	test('a worker cannot claim a review while a wait for it is written under its lease row', async () => {
		await coordinator.enqueue('review-1');

		const claimedDuringWrite = await coordinator.whileClaimable('review-1', () => peer.claim('replica-b'));

		expect(claimedDuringWrite).toBeNull();
		expect((await peer.claim('replica-b'))?.reviewId).toBe('review-1');
	});

	test('a wait is not written for a review a worker already holds', async () => {
		await coordinator.enqueue('review-1');
		await peer.claim('replica-b');

		let ran = false;

		const written = await coordinator.whileClaimable('review-1', async () => {
			ran = true;
		});

		expect({ ran, written }).toEqual({ ran: false, written: undefined });
	});
});
