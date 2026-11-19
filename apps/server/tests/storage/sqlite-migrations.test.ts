import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { DATA_VERSION } from '../../src/storage/data-version';
import { migrateSqlite, sqliteDataVersion } from '../../src/storage/sqlite-migrations';

test('a migration is recorded once and retains existing data', () => {
	using sqlite = new Database(':memory:');

	sqlite.run('CREATE TABLE legacy (value TEXT)');
	sqlite.run("INSERT INTO legacy VALUES ('saved')");

	const migration = (database: Database) => database.run('ALTER TABLE legacy ADD COLUMN id INTEGER');

	migrateSqlite(sqlite, [migration]);
	migrateSqlite(sqlite, [migration]);

	expect(sqliteDataVersion(sqlite)).toBe(DATA_VERSION);
	expect(sqlite.query('SELECT value, id FROM legacy').get()).toEqual({ value: 'saved', id: null });
});

test('a migration failure rolls back the schema and ledger together', () => {
	using sqlite = new Database(':memory:');

	expect(() =>
		migrateSqlite(sqlite, [
			(database) => {
				database.run('CREATE TABLE not_committed (value TEXT)');
				throw new Error('migration failed');
			}
		])
	).toThrow('migration failed');

	expect(sqliteDataVersion(sqlite)).toBe(0);
	expect(sqlite.query("SELECT name FROM sqlite_schema WHERE name = 'not_committed'").get()).toBeNull();
});

test('a release refuses a database that a newer version has migrated', () => {
	using sqlite = new Database(':memory:');

	const migration = (database: Database) => database.run('CREATE TABLE old_data (value TEXT)');

	migrateSqlite(sqlite, [migration]);
	sqlite.run('INSERT INTO recoder_migrations (version, applied_at) VALUES (?, ?)', [DATA_VERSION + 1, 'test']);

	expect(() => migrateSqlite(sqlite, [migration])).toThrow('newer than this Recoder release understands');
});
