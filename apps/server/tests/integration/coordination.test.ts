import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { PostgresCoordinator } from '../../src/review/runtime/coordinator';
import { CommandConflictError } from '../../src/review/runtime/commands';
import { enqueueCommand } from '../../src/review/runtime/inbox';
import { assertOwnership, OwnershipLostError, withLease, type ReviewLease } from '../../src/review/runtime/ownership';

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `coordination_${crypto.randomUUID().replaceAll('-', '')}`;

describe.skipIf(!databaseUrl)('Postgres review coordination (requires TEST_DATABASE_URL)', () => {
	const url = databaseUrl ?? 'postgres://unused.invalid/disabled';
	const admin = new SQL(url);
	const options = { connection: { search_path: schema, statement_timeout: 5000, lock_timeout: 1000 } };
	const firstSql = new SQL(url, options);
	const secondSql = new SQL(url, options);
	const first = new PostgresCoordinator(firstSql, { leaseMs: 30_000 });
	const second = new PostgresCoordinator(secondSql, { leaseMs: 30_000 });

	beforeAll(async () => {
		await admin`CREATE SCHEMA ${admin(schema)}`;
		await Promise.all([first.initialize(), second.initialize()]);
		await firstSql`CREATE TABLE protected_writes (value text NOT NULL)`;
	});

	beforeEach(async () => {
		await firstSql`TRUNCATE review_actor_leases, review_actor_commands, protected_writes RESTART IDENTITY CASCADE`;
	});

	afterAll(async () => {
		await Promise.all([firstSql.close(), secondSql.close()]);
		await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
		await admin.close();
	});

	async function claim(coordinator: PostgresCoordinator, ownerId: string): Promise<ReviewLease> {
		const lease = await coordinator.claim(ownerId);

		if (!lease) throw new Error('Expected a pending review actor.');

		return lease;
	}

	async function expire(lease: ReviewLease): Promise<void> {
		await firstSql`
			UPDATE review_actor_leases SET expires_at = clock_timestamp() - interval '1 second'
			WHERE review_id = ${lease.reviewId}
		`;
	}

	test('concurrent replicas claim one review only once', async () => {
		await first.enqueue('review-1');
		await second.enqueue('review-1');

		const claims = await Promise.all(Array.from({ length: 12 }, (_, index) => first.claim(`replica-${index}`)));

		expect(claims.filter((lease) => lease !== null)).toHaveLength(1);
		expect(await second.claim('another-replica')).toBeNull();
	});

	test('an expired owner is replaced with a higher epoch and cannot renew or write', async () => {
		await first.enqueue('review-1');

		const old = await claim(first, 'replica-a');

		await expire(old);

		const current = await claim(second, 'replica-b');

		expect(BigInt(current.epoch)).toBe(BigInt(old.epoch) + 1n);
		expect(await first.renew(old)).toBe(false);
		expect(await second.renew(current)).toBe(true);

		await expect(
			withLease(old, () =>
				firstSql.begin(async (tx) => {
					await assertOwnership(tx);
					await tx`INSERT INTO protected_writes VALUES ('stale')`;
				})
			)
		).rejects.toBeInstanceOf(OwnershipLostError);

		await withLease(current, () =>
			secondSql.begin(async (tx) => {
				await assertOwnership(tx);
				await tx`INSERT INTO protected_writes VALUES ('current')`;
			})
		);

		const rows = await firstSql<unknown[]>`SELECT value FROM protected_writes`;

		expect(rows).toEqual([{ value: 'current' }]);
	});

	test('an expired owner cannot revive its lease before a successor claims it', async () => {
		await first.enqueue('review-1');

		const lease = await claim(first, 'replica-a');

		await expire(lease);
		expect(await first.renew(lease)).toBe(false);
		await expect(first.readCommands(lease)).rejects.toBeInstanceOf(OwnershipLostError);
	});

	test('an ownership check holds the actor row against takeover until its write transaction commits', async () => {
		await first.enqueue('review-1');

		const lease = await claim(first, 'replica-a');

		await firstSql.begin(async (tx) => {
			await assertOwnership(tx, lease);

			await expect(
				secondSql.begin(async (contender) => {
					await contender`SELECT review_id FROM review_actor_leases FOR UPDATE NOWAIT`;
				})
			).rejects.toThrow('could not obtain lock');

			await tx`INSERT INTO protected_writes VALUES ('before-takeover')`;
		});

		await expire(lease);

		const successor = await claim(second, 'replica-b');

		expect(successor.ownerId).toBe('replica-b');

		const rows = await firstSql<unknown[]>`SELECT value FROM protected_writes`;

		expect(rows).toEqual([{ value: 'before-takeover' }]);
	});

	test('a locked pending actor does not block another review from being claimed', async () => {
		await first.enqueue('review-1');
		await first.enqueue('review-2');

		await firstSql.begin(async (tx) => {
			await tx`SELECT review_id FROM review_actor_leases WHERE review_id = 'review-1' FOR UPDATE`;

			const lease = await claim(second, 'replica-b');

			expect(lease.reviewId).toBe('review-2');
		});
	});

	test('unacknowledged commands survive owner death in order and stable IDs prevent duplicate delivery', async () => {
		await first.send('review-1', { id: 'start-1', kind: 'start' });

		await first.send('review-1', {
			id: 'chat-1',
			kind: 'chat',
			messageId: 'message-1',
			assignmentId: 'lead',
			text: 'Explain it.'
		});

		await second.send('review-1', {
			id: 'chat-1',
			kind: 'chat',
			messageId: 'message-1',
			assignmentId: 'lead',
			text: 'Explain it.'
		});

		const old = await claim(first, 'replica-a');
		const before = await first.readCommands(old);

		expect(before.map((entry) => entry.command.id)).toEqual(['start-1', 'chat-1']);
		await first.acknowledge(old, 'start-1');
		await expire(old);

		const current = await claim(second, 'replica-b');
		const remaining = await second.readCommands(current);

		expect(remaining.map((entry) => entry.command.id)).toEqual(['chat-1']);
		expect(remaining[0]?.sequence).toBe(before[1]?.sequence);
		await expect(first.acknowledge(old, 'chat-1')).rejects.toBeInstanceOf(OwnershipLostError);
		await second.acknowledge(current, 'chat-1');
		await second.release(current);
		expect(await first.claim('replica-c')).toBeNull();

		await first.send('review-1', {
			id: 'chat-1',
			kind: 'chat',
			messageId: 'message-1',
			assignmentId: 'lead',
			text: 'Explain it.'
		});

		expect(await first.claim('replica-c')).toBeNull();
	});

	test('releasing ownership preserves commands that arrived during the running actor', async () => {
		await first.enqueue('review-1');

		const lease = await claim(first, 'replica-a');

		await second.send('review-1', { id: 'cancel-1', kind: 'cancel' });
		await first.release(lease);

		const next = await claim(second, 'replica-b');

		expect((await second.readCommands(next)).map((entry) => entry.command.kind)).toEqual(['cancel']);
	});

	test('a repeated command ID cannot silently replace a different command', async () => {
		await first.send('review-1', { id: 'control-1', kind: 'pause' });

		await expect(second.send('review-1', { id: 'control-1', kind: 'cancel' })).rejects.toBeInstanceOf(
			CommandConflictError
		);

		const lease = await claim(first, 'replica-a');

		expect((await first.readCommands(lease)).map((entry) => entry.command.kind)).toEqual(['pause']);
	});

	test('acknowledged pause and cancellation remain authoritative after an ownership change', async () => {
		await first.send('review-1', { id: 'pause-1', kind: 'pause' });

		const original = await claim(first, 'replica-a');

		expect(await first.state(original)).toBe('paused');
		await first.acknowledge(original, 'pause-1');
		await expire(original);

		const successor = await claim(second, 'replica-b');

		expect(await second.state(successor)).toBe('paused');
		await first.send('review-1', { id: 'resume-1', kind: 'resume' });
		expect(await second.state(successor)).toBe('active');
		await second.acknowledge(successor, 'resume-1');
		await first.send('review-1', { id: 'cancel-1', kind: 'cancel' });
		await second.acknowledge(successor, 'cancel-1');
		await expire(successor);

		const final = await claim(first, 'replica-c');

		expect(await first.state(final)).toBe('cancelled');
		await second.send('review-1', { id: 'pause-1', kind: 'pause' });
		expect(await first.state(final)).toBe('cancelled');
	});

	test('a command arriving concurrently with release always wakes a successor', async () => {
		for (let index = 0; index < 12; index++) {
			const reviewId = `review-${index}`;

			await first.enqueue(reviewId);

			const lease = await claim(first, 'replica-a');

			await Promise.all([first.release(lease), second.send(reviewId, { id: 'cancel-1', kind: 'cancel' })]);

			const next = await claim(second, 'replica-b');

			expect(next.reviewId).toBe(reviewId);
			expect((await second.readCommands(next)).map((entry) => entry.command.kind)).toEqual(['cancel']);
			await second.acknowledge(next, 'cancel-1');
			await second.release(next);
		}
	});

	test('a review mutation and command enqueue roll back together in the caller transaction', async () => {
		await expect(
			firstSql.begin(async (tx) => {
				await tx`INSERT INTO protected_writes VALUES ('uncommitted-review')`;
				await enqueueCommand(tx, 'review-1', { id: 'start-1', kind: 'start' });
				throw new Error('Stop before commit.');
			})
		).rejects.toThrow('Stop before commit.');

		const rows = await firstSql<unknown[]>`SELECT value FROM protected_writes`;

		expect(rows).toEqual([]);
		expect(await first.claim('replica-a')).toBeNull();
	});
});
