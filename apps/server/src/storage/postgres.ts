import type { SQL, TransactionSQL } from 'bun';
import type { Collection, Table } from './collection';
import { currentPostgresTransaction, withPostgresTransaction } from './postgres-transactions';

type RecordTable = Table | 'review_diffs';

type WriteGuard = (transaction: TransactionSQL) => Promise<void>;

export async function initializePostgresStore(database: SQL): Promise<void> {
	await database.begin(async (transaction) => {
		await transaction`SELECT pg_advisory_xact_lock(hashtextextended('recoder:records:schema', 0))`;

		await transaction`
			CREATE TABLE IF NOT EXISTS recoder_records (
				collection TEXT NOT NULL,
				id TEXT NOT NULL,
				value JSONB NOT NULL,
				position BIGINT GENERATED ALWAYS AS IDENTITY,
				PRIMARY KEY (collection, id)
			)
		`;
	});
}

export class PostgresStore {
	constructor(
		private readonly database: SQL,
		private readonly guard: WriteGuard
	) {}

	collection<T extends { id: string }>(table: RecordTable): Collection<T> {
		const connection = () => currentPostgresTransaction() ?? this.database;

		const read = async (database: SQL, id: string): Promise<T | undefined> => {
			const rows = await database<{ value: T }[]>`
				SELECT value FROM recoder_records WHERE collection = ${table} AND id = ${id}
			`;

			return rows[0]?.value;
		};

		const write = async (database: SQL, item: T): Promise<T> => {
			await database`
				INSERT INTO recoder_records (collection, id, value)
				VALUES (${table}, ${item.id}, CAST(${JSON.stringify(item)} AS TEXT)::jsonb)
				ON CONFLICT (collection, id) DO UPDATE SET value = excluded.value
			`;

			return item;
		};

		const locked = async <R>(id: string, work: (transaction: TransactionSQL) => Promise<R>): Promise<R> => {
			return withPostgresTransaction(this.database, async (transaction) => {
				await this.guard(transaction);
				await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([table, id])}, 0))`;

				return work(transaction);
			});
		};

		return {
			list: async () => {
				const rows = await connection()<{ value: T }[]>`
					SELECT value FROM recoder_records WHERE collection = ${table} ORDER BY position
				`;

				return rows.map((row) => row.value);
			},
			get: (id) => read(connection(), id),
			set: (item) => locked(item.id, (transaction) => write(transaction, item)),
			delete: (id) =>
				locked(id, async (transaction) => {
					const deleted = await transaction<{ id: string }[]>`
					DELETE FROM recoder_records WHERE collection = ${table} AND id = ${id} RETURNING id
				`;

					return deleted.length > 0;
				}),
			clear: () =>
				withPostgresTransaction(this.database, async (transaction) => {
					await this.guard(transaction);
					await transaction`DELETE FROM recoder_records WHERE collection = ${table}`;
				}),
			update: (id, mutate) =>
				locked(id, async (transaction) => {
					const next = mutate(await read(transaction, id));

					if (next && next.id !== id) throw new Error('A stored record update cannot change its id.');
					if (next) return write(transaction, next);

					await transaction`DELETE FROM recoder_records WHERE collection = ${table} AND id = ${id}`;

					return undefined;
				})
		};
	}
}
