import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { serverDataDir } from '../util/data-dir';
import type { Collection, Table } from './collection';

let handle: Database | null = null;

export function sqlite(): Database {
	if (!handle) {
		handle = new Database(join(serverDataDir(), 'recoder.db'));
		handle.run('PRAGMA journal_mode = WAL');

		for (const table of [
			'repos',
			'reviews',
			'runs',
			'review_progress',
			'review_metrics',
			'review_checkpoints',
			'review_replays'
		]) {
			handle.run(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, value TEXT NOT NULL)`);
		}

		handle.run('CREATE TABLE IF NOT EXISTS review_diffs (review_id TEXT PRIMARY KEY, diff TEXT NOT NULL)');
	}

	return handle;
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
			sqlite().transaction(() => {
				const next = mutate(get(id));

				if (next && next.id !== id) throw new Error('A stored record update cannot change its id.');
				if (next) set(next);
				else sqlite().query(`DELETE FROM ${table} WHERE id = ?`).run(id);

				return next;
			})()
	};
}
