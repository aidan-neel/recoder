import type { SQL } from 'bun';
import { z } from 'zod';
import { queuedCommandSchema, type QueuedCommand, type ReviewCommand } from './commands';
import { enqueueActor, enqueueCommand } from './inbox';
import { assertOwnership, reviewLeaseSchema, type ReviewLease } from './ownership';
import { initializeCoordinator } from './schema';

const identifier = z.string().min(1).max(200);
const duration = z.number().int().min(100).max(300_000);

export class PostgresCoordinator {
	private readonly leaseMs: number;

	constructor(
		private readonly sql: SQL,
		options: { leaseMs: number }
	) {
		this.leaseMs = duration.parse(options.leaseMs);
	}

	async initialize(): Promise<void> {
		await initializeCoordinator(this.sql);
	}

	async enqueue(reviewId: string): Promise<void> {
		await this.sql.begin((tx) => enqueueActor(tx, reviewId));
	}

	async send(reviewId: string, input: ReviewCommand): Promise<void> {
		await this.sql.begin((tx) => enqueueCommand(tx, reviewId, input));
	}

	async claim(ownerId: string): Promise<ReviewLease | null> {
		identifier.parse(ownerId);

		const rows = await this.sql<unknown[]>`
			WITH candidate AS (
				SELECT review_id FROM review_actor_leases
				WHERE (owner_id IS NULL AND pending) OR expires_at <= clock_timestamp()
				ORDER BY requested_at, review_id
				FOR UPDATE SKIP LOCKED LIMIT 1
			)
			UPDATE review_actor_leases AS actor
			SET owner_id = ${ownerId}, epoch = actor.epoch + 1,
			    expires_at = clock_timestamp() + ${this.leaseMs} * interval '1 millisecond', pending = false
			FROM candidate WHERE actor.review_id = candidate.review_id
			RETURNING actor.review_id AS "reviewId", actor.owner_id AS "ownerId",
			          actor.epoch::text AS epoch, actor.expires_at AS "expiresAt"
		`;

		return rows.length ? reviewLeaseSchema.parse(rows[0]) : null;
	}

	async renew(lease: ReviewLease): Promise<boolean> {
		const rows = await this.sql<unknown[]>`
			UPDATE review_actor_leases
			SET expires_at = clock_timestamp() + ${this.leaseMs} * interval '1 millisecond'
			WHERE review_id = ${lease.reviewId} AND owner_id = ${lease.ownerId}
			  AND epoch = ${lease.epoch}::bigint AND expires_at > clock_timestamp()
			RETURNING review_id
		`;

		return rows.length === 1;
	}

	async release(lease: ReviewLease, options: { requeue?: boolean } = {}): Promise<void> {
		await this.sql.begin(async (tx) => {
			await assertOwnership(tx, lease, { lock: 'exclusive' });

			await tx`
				UPDATE review_actor_leases SET owner_id = NULL, expires_at = NULL,
				pending = ${options.requeue ?? false} OR EXISTS (
					SELECT 1 FROM review_actor_commands
					WHERE review_id = ${lease.reviewId} AND acknowledged_at IS NULL
				)
				WHERE review_id = ${lease.reviewId}
			`;
		});
	}

	async state(lease: ReviewLease): Promise<'active' | 'paused' | 'cancelled'> {
		return this.sql.begin(async (tx) => {
			await assertOwnership(tx, lease);

			const rows = await tx<
				unknown[]
			>`SELECT desired_state AS state FROM review_actor_leases WHERE review_id = ${lease.reviewId}`;

			return z.object({ state: z.enum(['active', 'paused', 'cancelled']) }).parse(rows[0]).state;
		});
	}

	async readCommands(lease: ReviewLease): Promise<QueuedCommand[]> {
		return this.sql.begin(async (tx) => {
			await assertOwnership(tx, lease);

			const rows = await tx<unknown[]>`
				SELECT sequence::text, command, cancelled_at IS NOT NULL AS cancelled FROM review_actor_commands
				WHERE review_id = ${lease.reviewId} AND acknowledged_at IS NULL
				ORDER BY sequence LIMIT 100
			`;

			return z.array(queuedCommandSchema).parse(rows);
		});
	}

	async readCancellationReason(lease: ReviewLease): Promise<string | undefined> {
		return this.sql.begin(async (tx) => {
			await assertOwnership(tx, lease);

			const rows = await tx<unknown[]>`
				SELECT command->>'reason' AS reason FROM review_actor_commands
				WHERE review_id = ${lease.reviewId} AND command->>'kind' = 'cancel'
				ORDER BY sequence DESC LIMIT 1
			`;

			return rows.length ? (z.object({ reason: z.string().nullable() }).parse(rows[0]).reason ?? undefined) : undefined;
		});
	}

	async acknowledge(lease: ReviewLease, commandId: string): Promise<void> {
		await this.sql.begin(async (tx) => {
			await assertOwnership(tx, lease);

			await tx`
				UPDATE review_actor_commands SET acknowledged_at = clock_timestamp()
				WHERE review_id = ${lease.reviewId} AND command_id = ${commandId} AND acknowledged_at IS NULL
			`;
		});
	}
}
