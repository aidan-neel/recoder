import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { serverDataDir } from '../util/data-dir';
import type { Collection, Table } from './collection';
import { prepareReviewList, refreshReviewListShape } from './review-list-schema';
import { migrateSqlite } from './sqlite-migrations';
import { initializeSqliteMessages } from './message-schema';

let handle: Database | null = null;

/**
 * How long a write waits for another process's write to finish. The server, the CLI and a benchmark can open the
 * same data directory; without a wait SQLite refuses the second writer at once with "database is locked". A
 * collection's read-then-write `update` takes the write lock before it reads (`immediate`): SQLite refuses a deferred
 * transaction's upgrade from read to write at once, without waiting, when another connection wrote in between.
 */
const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export function sqlite(): Database {
	if (handle) return handle;

	const database = new Database(join(serverDataDir(), 'recoder.db'));

	try {
		database.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
		migrateSqlite(database, [initializeSqliteSchema, addPullDescriptions, initializeSqliteMessages]);
		database.run('PRAGMA journal_mode = WAL');
		database.run('PRAGMA secure_delete = ON');
		refreshReviewListShape(database);
		handle = database;

		return database;
	} catch (error) {
		database.close();
		throw error;
	}
}

function initializeSqliteSchema(database: Database): void {
	for (const table of [
		'repos',
		'reviews',
		'runs',
		'review_progress',
		'review_metrics',
		'review_checkpoints',
		'review_replays',
		'repo_chats',
		'images',
		'review_images',
		'accounts',
		'sessions',
		'setup',
		'oauth_redirects',
		'member_models',
		'update_state',
		'pull_states',
		'model_calls'
	]) {
		database.run(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, value TEXT NOT NULL)`);
	}

	prepareReviewList(database);
	database.run("CREATE INDEX IF NOT EXISTS model_calls_at ON model_calls (substr(json_extract(value, '$.at'), 1, 10))");
	database.run('CREATE TABLE IF NOT EXISTS review_diffs (review_id TEXT PRIMARY KEY, diff TEXT NOT NULL)');
}

function addPullDescriptions(database: Database): void {
	database.run('CREATE TABLE IF NOT EXISTS pull_descriptions (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
}

export async function closeSqlite(): Promise<void> {
	handle?.close();
	handle = null;
}

export function sqliteCollection<T extends { id: string }>(table: Table): Collection<T> {
	const get = (id: string): T | undefined => {
		const row = sqlite().query<{ value: string }, [string]>(`SELECT value FROM ${table} WHERE id = ?`).get(id);

		return row ? JSON.parse(row.value) : undefined;
	};

	const set = (item: T): T => {
		sqlite()
			.query(`INSERT INTO ${table} (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value`)
			.run(item.id, JSON.stringify(item));

		return item;
	};

	return {
		list: async () =>
			sqlite()
				.query<{ value: string }, []>(`SELECT value FROM ${table} ORDER BY rowid`)
				.all()
				.map((row) => JSON.parse(row.value)),
		get: async (id) => get(id),
		set: async (item) => set(item),
		delete: async (id) => sqlite().query(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0,
		clear: async () => {
			sqlite().query(`DELETE FROM ${table}`).run();
		},
		update: async (id, mutate) =>
			sqlite()
				.transaction(() => {
					const next = mutate(get(id));

					if (next && next.id !== id) throw new Error('A stored record update cannot change its id.');
					if (next) set(next);
					else sqlite().query(`DELETE FROM ${table} WHERE id = ?`).run(id);

					return next;
				})
				.immediate()
	};
}
