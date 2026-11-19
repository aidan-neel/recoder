import { Database } from 'bun:sqlite';
import { chmod } from 'node:fs/promises';
import { sqliteDataVersion } from '../sqlite-migrations';
import { MAX_DATABASE_BYTES, openBackupFile } from './archive';

/** VACUUM copies committed WAL data into one DB file. A separate process keeps the HTTP event loop responsive. */
export async function snapshotSqlite(source: string, destination: string): Promise<void> {
	const { handle } = await openBackupFile(source, MAX_DATABASE_BYTES);

	await handle.close();

	const snapshot = Bun.spawn([process.execPath, import.meta.path, source, destination], {
		stdin: 'ignore',
		stdout: 'ignore',
		stderr: 'ignore',
		signal: AbortSignal.timeout(10 * 60_000)
	});

	if ((await snapshot.exited) !== 0) throw new Error('Could not make a consistent SQLite snapshot.');

	await chmod(destination, 0o600);
}

/** Opens without modifying the snapshot; validates it before it can replace any live data. */
export function sqliteSnapshotVersion(path: string, checkIntegrity = false): number {
	using database = new Database(path, { readonly: true });

	if (checkIntegrity) {
		const results = database.query<{ quick_check: string }, []>('PRAGMA quick_check').all();

		if (results.length !== 1 || results[0].quick_check !== 'ok')
			throw new Error('The SQLite backup failed its integrity check.');
	}

	return sqliteDataVersion(database);
}

if (import.meta.main) {
	const [source, destination] = process.argv.slice(2);

	if (!source || !destination) process.exit(2);

	using database = new Database(source, { readonly: true });

	database.run('PRAGMA busy_timeout = 5000');
	database.run('VACUUM INTO ?', [destination]);
}
