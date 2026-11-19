import type { Database } from 'bun:sqlite';
import { pendingVersions } from './data-version';

export function sqliteDataVersion(database: Database): number {
	const ledger = database.query("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'recoder_migrations'");

	if (!ledger.get()) return 0;

	const row = database
		.query<{ version: number; count: number }, []>(
			'SELECT coalesce(max(version), 0) AS version, count(*) AS count FROM recoder_migrations'
		)
		.get()!;

	if (row.version !== row.count) throw new Error('The data migration ledger has a missing version.');

	return row.version;
}

/** The SQLite writer lock spans reading the ledger, changing the schema, and recording each applied version. */
export function migrateSqlite(database: Database, migrations: ReadonlyArray<(database: Database) => void>): void {
	database
		.transaction(() => {
			database.run(
				'CREATE TABLE IF NOT EXISTS recoder_migrations (version INTEGER PRIMARY KEY CHECK (version > 0), applied_at TEXT NOT NULL)'
			);

			for (const version of pendingVersions(sqliteDataVersion(database), migrations.length)) {
				migrations[version - 1]!(database);

				database.run('INSERT INTO recoder_migrations (version, applied_at) VALUES (?, ?)', [
					version,
					new Date().toISOString()
				]);
			}
		})
		.immediate();
}
