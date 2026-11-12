import { AsyncLocalStorage } from 'node:async_hooks';
import type { TransactionSQL } from 'bun';
import { z } from 'zod';

export const reviewLeaseSchema = z.object({
	reviewId: z.string().min(1).max(200),
	ownerId: z.string().min(1).max(200),
	epoch: z.string().regex(/^[1-9][0-9]*$/),
	expiresAt: z.coerce.date()
});

export type ReviewLease = z.infer<typeof reviewLeaseSchema>;

export class OwnershipLostError extends Error {
	constructor(reviewId: string) {
		super(`Ownership of review ${reviewId} expired or moved to another server.`);
		this.name = 'OwnershipLostError';
	}
}

const context = new AsyncLocalStorage<ReviewLease>();

export function withLease<T>(lease: ReviewLease, work: () => T): T {
	return context.run(lease, work);
}

export function currentLease(): ReviewLease | undefined {
	return context.getStore();
}

/** Hold the ownership row until the caller's transaction commits, so takeover cannot race its writes. */
export async function assertOwnership(
	tx: TransactionSQL,
	lease = currentLease(),
	options: { lock: 'shared' | 'exclusive' } = { lock: 'shared' }
): Promise<void> {
	if (!lease) return;

	const lock = options.lock === 'exclusive' ? tx`FOR UPDATE` : tx`FOR SHARE`;

	const rows = await tx<unknown[]>`
		SELECT review_id FROM review_actor_leases
		WHERE review_id = ${lease.reviewId}
		  AND owner_id = ${lease.ownerId}
		  AND epoch = ${lease.epoch}::bigint
		  AND expires_at > clock_timestamp()
		${lock}
	`;

	if (rows.length !== 1) throw new OwnershipLostError(lease.reviewId);
}
