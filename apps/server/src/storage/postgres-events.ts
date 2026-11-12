import type { SQL, TransactionSQL } from 'bun';
import { emptyReviewProgress, type ReviewProgress } from '@recoder/shared';
import type { ReviewEvent } from '../review/session/events';
import { PostgresStore } from './postgres';
import { currentPostgresTransaction, withPostgresTransaction } from './postgres-transactions';

export type StoredReviewEvent = ReviewEvent & { sequence: number };

type EventInput = Omit<ReviewEvent, 'at' | 'sequence'>;

type Reducer = (snapshot: ReviewProgress, event: StoredReviewEvent) => ReviewProgress;

export async function initializePostgresEvents(database: SQL): Promise<void> {
	await database.begin(async (transaction) => {
		await transaction`SELECT pg_advisory_xact_lock(hashtextextended('recoder:events:schema', 0))`;

		await transaction`
			CREATE TABLE IF NOT EXISTS recoder_review_events (
				review_id TEXT NOT NULL,
				sequence BIGINT NOT NULL,
				event JSONB NOT NULL,
				PRIMARY KEY (review_id, sequence)
			)
		`;
	});
}

export class PostgresEvents {
	private readonly progress;

	constructor(
		private readonly database: SQL,
		private readonly guard: (transaction: TransactionSQL) => Promise<void>
	) {
		this.progress = new PostgresStore(database, guard).collection<ReviewProgress>('review_progress');
	}

	async append(reviewId: string, input: EventInput, reduce: Reducer): Promise<StoredReviewEvent> {
		return withPostgresTransaction(this.database, async (transaction) => {
			const message: StoredReviewEvent = { ...input, at: new Date().toISOString(), sequence: 0 };

			const next = await this.progress.update(reviewId, (current) => {
				const snapshot = current ?? emptyReviewProgress(reviewId);

				message.sequence = snapshot.sequence + 1;
				snapshot.sequence = message.sequence;
				snapshot.updatedAt = message.at;

				return reduce(snapshot, message);
			});

			if (!next) throw new Error('The review event reducer must preserve its progress snapshot.');

			await transaction`
				INSERT INTO recoder_review_events (review_id, sequence, event)
				VALUES (${reviewId}, ${message.sequence}, ${JSON.stringify(message)}::text::jsonb)
			`;

			await transaction`
				DELETE FROM recoder_review_events
				WHERE review_id = ${reviewId} AND sequence <= ${message.sequence - 400}
			`;

			return message;
		});
	}

	async after(reviewId: string, sequence: number): Promise<StoredReviewEvent[]> {
		const database = currentPostgresTransaction() ?? this.database;

		const rows = await database<{ event: StoredReviewEvent }[]>`
			SELECT event FROM recoder_review_events
			WHERE review_id = ${reviewId} AND sequence > ${sequence}
			ORDER BY sequence LIMIT 400
		`;

		return rows.map((row) => row.event);
	}

	async clear(reviewId: string): Promise<void> {
		await withPostgresTransaction(this.database, async (transaction) => {
			await this.guard(transaction);
			await transaction`DELETE FROM recoder_review_events WHERE review_id = ${reviewId}`;
			await this.progress.delete(reviewId);
		});
	}
}
