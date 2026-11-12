import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serverDataDir } from './data-dir.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A fact no review read for this long is dropped when the store next opens. */
const MAX_UNUSED_MS = 14 * DAY_MS;

/** A read refreshes a fact's last use at most this often, so reading many facts writes little. */
const TOUCH_AFTER_MS = DAY_MS;

/**
 * Facts about code that never change once known, such as the declarations
 * parsed from one file blob or the pull requests one commit landed in. They
 * are kept in one SQLite file under the data dir, which the sandbox hides, so
 * the next review of the same repository, on any pull request, reads them
 * back instead of working them out again.
 */
let open: { path: string; db: Database } | null = null;

function store(): Database {
	const dir = join(serverDataDir(), 'cache');
	const path = join(dir, 'facts.db');

	if (open?.path === path) return open.db;

	open?.db.close();
	mkdirSync(dir, { recursive: true });

	const db = new Database(path);

	db.run('PRAGMA journal_mode = WAL');
	db.run('PRAGMA busy_timeout = 2000');

	db.run(
		'CREATE TABLE IF NOT EXISTS facts (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, used_at INTEGER NOT NULL, PRIMARY KEY (namespace, key))'
	);

	db.query('DELETE FROM facts WHERE used_at < ?').run(Date.now() - MAX_UNUSED_MS);
	open = { path, db };

	return db;
}

/**
 * The fact stored under `key`, or null when there is none. The caller names
 * the type: a namespace only ever holds what its one writer stores, and a
 * writer that changes its format puts a new version into its keys.
 */
export function readFact<T>(namespace: string, key: string): T | null {
	const db = store();

	const row = db.query('SELECT value FROM facts WHERE namespace = ? AND key = ?').get(namespace, key) as {
		value: string;
	} | null;

	if (!row) return null;

	const now = Date.now();

	db.query('UPDATE facts SET used_at = ? WHERE namespace = ? AND key = ? AND used_at < ?').run(
		now,
		namespace,
		key,
		now - TOUCH_AFTER_MS
	);

	return JSON.parse(row.value) as T;
}

/** Stores a fact, replacing one held under the same key. */
export function writeFact(namespace: string, key: string, value: unknown): void {
	store()
		.query(
			'INSERT INTO facts (namespace, key, value, used_at) VALUES (?, ?, ?, ?) ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, used_at = excluded.used_at'
		)
		.run(namespace, key, JSON.stringify(value), Date.now());
}

/** Closes the store, as a server restart would; the next read opens it again. */
export function closeFacts(): void {
	open?.db.close();
	open = null;
}
