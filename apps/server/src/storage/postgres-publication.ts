import { SQL, type TransactionSQL } from 'bun';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';

const commentSchema = z.object({ id: z.string().min(1), url: z.string().min(1), inline: z.boolean() });

const publicationSchema = z.discriminatedUnion('state', [
	z.object({ state: z.literal('ready'), comment: z.null() }),
	z.object({ state: z.literal('uncertain'), comment: z.null() }),
	z.object({ state: z.literal('posted'), comment: commentSchema })
]);

export type PublishedComment = z.infer<typeof commentSchema>;

const lockPools = new WeakMap<SQL, SQL>();

function lockPool(database: SQL): SQL {
	let pool = lockPools.get(database);

	if (!pool) {
		pool = new SQL({ ...database.options, max: 2, connectionTimeout: 5, idleTimeout: 30 });
		lockPools.set(database, pool);
	}

	return pool;
}

export async function closePublicationStorage(database: SQL): Promise<void> {
	await lockPools.get(database)?.close();
	lockPools.delete(database);
}

interface PublicationAttempt {
	marker: string;
	known?: PublishedComment;
	find: () => Promise<PublishedComment | null>;
	edit: (comment: PublishedComment) => Promise<PublishedComment>;
	create: () => Promise<PublishedComment>;
	isMissing: (error: unknown) => boolean;
	isRejected: (error: unknown) => boolean;
}

export class PublicationUncertainError extends Error {
	constructor() {
		super(
			'The previous comment create may have succeeded, but its marker was not found. Check the pull request before retrying; Recoder will not create a second comment while the outcome is uncertain.'
		);

		this.name = 'PublicationUncertainError';
	}
}

export async function initializePublication(database: SQL): Promise<void> {
	await database.begin(async (transaction) => {
		await transaction`SELECT pg_advisory_xact_lock(hashtextextended('recoder:publication:schema', 0))`;

		await transaction`
			CREATE TABLE IF NOT EXISTS recoder_publications (
				publication_key TEXT NOT NULL,
				marker TEXT NOT NULL,
				state TEXT NOT NULL CHECK (state IN ('ready', 'uncertain', 'posted')),
				comment JSONB,
				updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
				PRIMARY KEY (publication_key, marker),
				CHECK ((state = 'posted') = (comment IS NOT NULL))
			)
		`;
	});
}

export class PublicationSession {
	constructor(
		private readonly database: SQL,
		private readonly key: string,
		private readonly guard: (transaction: TransactionSQL) => Promise<void>
	) {}

	private async checkOwner(): Promise<void> {
		await this.database.begin((transaction) => this.guard(transaction));
	}

	private async save(marker: string, value: z.infer<typeof publicationSchema>): Promise<void> {
		const comment = value.comment === null ? null : JSON.stringify(value.comment);

		await this.database.begin(async (transaction) => {
			await this.guard(transaction);

			await transaction`
				INSERT INTO recoder_publications (publication_key, marker, state, comment)
				VALUES (${this.key}, ${marker}, ${value.state}, ${comment}::text::jsonb)
				ON CONFLICT (publication_key, marker) DO UPDATE
				SET state = excluded.state, comment = excluded.comment, updated_at = clock_timestamp()
			`;
		});
	}

	async publish(attempt: PublicationAttempt): Promise<PublishedComment> {
		const rows = await this.database<unknown[]>`
			SELECT state, comment FROM recoder_publications
			WHERE publication_key = ${this.key} AND marker = ${attempt.marker}
		`;

		const stored = rows[0] === undefined ? undefined : publicationSchema.parse(rows[0]);
		const known = stored?.state === 'posted' ? stored.comment : attempt.known;

		if (known) {
			await this.checkOwner();

			try {
				const edited = await attempt.edit(known);

				await this.save(attempt.marker, { state: 'posted', comment: edited });

				return edited;
			} catch (error) {
				if (!attempt.isMissing(error)) throw error;
			}
		}

		const found = await attempt.find();

		if (found) {
			await this.save(attempt.marker, { state: 'posted', comment: found });
			await this.checkOwner();

			const edited = await attempt.edit(found);

			await this.save(attempt.marker, { state: 'posted', comment: edited });

			return edited;
		}

		if (stored?.state === 'uncertain') throw new PublicationUncertainError();

		await this.save(attempt.marker, { state: 'uncertain', comment: null });
		await this.checkOwner();

		let posted: PublishedComment;

		try {
			posted = await attempt.create();
		} catch (error) {
			if (attempt.isRejected(error)) await this.save(attempt.marker, { state: 'ready', comment: null });
			throw error;
		}

		await this.save(attempt.marker, { state: 'posted', comment: posted });

		return posted;
	}
}

export class PostgresPublications {
	constructor(
		private readonly database: SQL,
		private readonly guard: (transaction: TransactionSQL) => Promise<void>
	) {}

	async run<T>(key: string, work: (session: PublicationSession) => Promise<T>): Promise<T> {
		const context = AsyncLocalStorage.snapshot();

		return lockPool(this.database).begin(async (transaction) => {
			await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`recoder:publication:${key}`}, 0))`;

			return context(() => work(new PublicationSession(this.database, key, this.guard)));
		});
	}
}
