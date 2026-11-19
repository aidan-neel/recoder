import type { SQL, TransactionSQL } from 'bun';
import { pendingVersions } from './data-version';
import { withPostgresTransaction } from './postgres-transactions';

export async function postgresDataVersion(database: SQL): Promise<number> {
	const [row] = await database<{ version: number; count: number }[]>`
		SELECT coalesce(max(version), 0) AS version, count(*)::int AS count FROM recoder_migrations
	`;

	if (row.version !== row.count) throw new Error('The data migration ledger has a missing version.');

	return row.version;
}

/** Replicas take the same schema-scoped lock; failed SQL rolls back both the migration and its ledger row. */
export async function migratePostgres(
	database: SQL,
	migrations: ReadonlyArray<(transaction: TransactionSQL) => Promise<void>>
): Promise<void> {
	await withPostgresTransaction(database, async (transaction) => {
		await transaction`SELECT pg_advisory_xact_lock(hashtext(current_schema()), hashtext('recoder_migrations'))`;

		await transaction`
			CREATE TABLE IF NOT EXISTS recoder_migrations (
				version integer PRIMARY KEY CHECK (version > 0), applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
			)
		`;

		for (const version of pendingVersions(await postgresDataVersion(transaction), migrations.length)) {
			await migrations[version - 1]!(transaction);
			await transaction`INSERT INTO recoder_migrations (version) VALUES (${version})`;
		}
	});
}
