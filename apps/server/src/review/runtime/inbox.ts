import type { TransactionSQL } from 'bun';
import { z } from 'zod';
import { CommandConflictError, reviewCommandSchema, type ReviewCommand } from './commands';

const identifier = z.string().min(1).max(200);

export async function enqueueActor(tx: TransactionSQL, reviewId: string): Promise<void> {
	identifier.parse(reviewId);

	await tx`
		INSERT INTO review_actor_leases (review_id) VALUES (${reviewId})
		ON CONFLICT (review_id) DO UPDATE SET pending = true, requested_at = clock_timestamp()
	`;
}

function desiredState(command: ReviewCommand): 'active' | 'paused' | 'cancelled' | null {
	if (command.kind === 'pause') return 'paused';
	if (command.kind === 'cancel') return 'cancelled';
	if (['start', 'continue', 'rerun', 'replay', 'resume'].includes(command.kind)) return 'active';

	return null;
}

export async function enqueueCommand(tx: TransactionSQL, reviewId: string, input: ReviewCommand): Promise<void> {
	identifier.parse(reviewId);

	const command = reviewCommandSchema.parse(input);
	const encoded = JSON.stringify(command);

	await tx`INSERT INTO review_actor_leases (review_id) VALUES (${reviewId}) ON CONFLICT DO NOTHING`;
	await tx`SELECT review_id FROM review_actor_leases WHERE review_id = ${reviewId} FOR UPDATE`;

	const inserted = await tx<unknown[]>`
		INSERT INTO review_actor_commands (review_id, command_id, command)
		VALUES (${reviewId}, ${command.id}, ${encoded}::text::jsonb)
		ON CONFLICT (review_id, command_id) DO NOTHING RETURNING command_id
	`;

	if (!inserted.length) {
		const matching = await tx<unknown[]>`
			SELECT command_id FROM review_actor_commands
			WHERE review_id = ${reviewId} AND command_id = ${command.id} AND command = ${encoded}::text::jsonb
		`;

		if (!matching.length) throw new CommandConflictError(command.id);

		return;
	}

	if (command.kind === 'stop-chat') {
		await tx`
			UPDATE review_actor_commands SET cancelled_at = clock_timestamp()
			WHERE review_id = ${reviewId} AND acknowledged_at IS NULL
			  AND command->>'kind' = 'chat' AND command->>'assignmentId' = ${command.assignmentId}
		`;
	}

	await tx`
		UPDATE review_actor_leases
		SET pending = true, requested_at = clock_timestamp(), desired_state = COALESCE(${desiredState(command)}::text, desired_state)
		WHERE review_id = ${reviewId}
	`;
}
