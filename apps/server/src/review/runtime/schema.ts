import type { SQL } from 'bun';

export async function initializeCoordinator(sql: SQL): Promise<void> {
	await sql.begin(async (tx) => {
		await tx`SELECT pg_advisory_xact_lock(732646852)`;

		await tx`
			CREATE TABLE IF NOT EXISTS review_actor_leases (
				review_id text PRIMARY KEY,
				owner_id text,
				epoch bigint NOT NULL DEFAULT 0 CHECK (epoch >= 0),
				expires_at timestamptz,
				pending boolean NOT NULL DEFAULT true,
				desired_state text NOT NULL DEFAULT 'active' CHECK (desired_state IN ('active', 'paused', 'cancelled')),
				requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
				CHECK ((owner_id IS NULL) = (expires_at IS NULL))
			)
		`;

		await tx`
			CREATE TABLE IF NOT EXISTS review_actor_commands (
				sequence bigserial PRIMARY KEY,
				review_id text NOT NULL REFERENCES review_actor_leases(review_id) ON DELETE CASCADE,
				command_id text NOT NULL,
				command jsonb NOT NULL,
				acknowledged_at timestamptz,
				UNIQUE (review_id, command_id)
			)
		`;

		await tx`ALTER TABLE review_actor_commands ADD COLUMN IF NOT EXISTS cancelled_at timestamptz`;

		await tx`
			CREATE INDEX IF NOT EXISTS review_actor_commands_pending
			ON review_actor_commands (review_id, sequence) WHERE acknowledged_at IS NULL
		`;
	});
}
