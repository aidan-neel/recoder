import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { DATA_VERSION } from '../../src/storage/data-version';
import { initializeSqliteMessages } from '../../src/storage/message-schema';
import { migrateSqlite, sqliteDataVersion } from '../../src/storage/sqlite-migrations';

const noChange = () => {};

test('a migration is recorded once and retains existing data', () => {
	using sqlite = new Database(':memory:');

	sqlite.run('CREATE TABLE legacy (value TEXT)');
	sqlite.run("INSERT INTO legacy VALUES ('saved')");

	const migration = (database: Database) => database.run('ALTER TABLE legacy ADD COLUMN id INTEGER');

	migrateSqlite(sqlite, [noChange, migration, noChange]);
	migrateSqlite(sqlite, [noChange, migration, noChange]);

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
			},
			noChange,
			noChange
		])
	).toThrow('migration failed');

	expect(sqliteDataVersion(sqlite)).toBe(0);
	expect(sqlite.query("SELECT name FROM sqlite_schema WHERE name = 'not_committed'").get()).toBeNull();
});

test('a release refuses a database that a newer version has migrated', () => {
	using sqlite = new Database(':memory:');

	const migration = (database: Database) => database.run('CREATE TABLE old_data (value TEXT)');

	migrateSqlite(sqlite, [migration, noChange, noChange]);
	sqlite.run('INSERT INTO recoder_migrations (version, applied_at) VALUES (?, ?)', [DATA_VERSION + 1, 'test']);

	expect(() => migrateSqlite(sqlite, [migration, noChange, noChange])).toThrow(
		'newer than this Recoder release understands'
	);
});

test('a version 2 database retains its data when the message tables are added', () => {
	using sqlite = new Database(':memory:');

	sqlite.exec(`
		CREATE TABLE recoder_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
		INSERT INTO recoder_migrations VALUES (1, 'test'), (2, 'test');
		CREATE TABLE pull_descriptions (id TEXT PRIMARY KEY, value TEXT NOT NULL);
		INSERT INTO pull_descriptions VALUES ('saved', '{}');
	`);

	migrateSqlite(sqlite, [noChange, noChange, initializeSqliteMessages]);

	expect(sqliteDataVersion(sqlite)).toBe(3);
	expect(sqlite.query('SELECT id FROM pull_descriptions').get()).toEqual({ id: 'saved' });

	expect(
		sqlite
			.query<{ name: string }, []>(
				"SELECT name FROM sqlite_schema WHERE type = 'table' AND name GLOB 'dm_*' ORDER BY name"
			)
			.all()
			.map(({ name }) => name)
	).toEqual(['dm_conversations', 'dm_inbox', 'dm_inbox_cursors', 'dm_messages', 'dm_reads']);
});
