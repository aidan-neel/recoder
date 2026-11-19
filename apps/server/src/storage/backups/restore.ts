import { constants, createWriteStream } from 'node:fs';
import { lstat, mkdtemp, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { assertReadableDataVersion } from '../data-version';
import {
	BACKUP_SETTINGS,
	extractArchive,
	MAX_DATABASE_BYTES,
	MAX_SETTINGS_BYTES,
	openBackupFile,
	POSTGRES_SNAPSHOT,
	readManifest,
	SQLITE_SNAPSHOT,
	type BackupManifest
} from './archive';
import { restorePostgres } from './postgres-snapshot';
import { sqliteSnapshotVersion } from './sqlite-snapshot';
import { isMissingFile } from './store';

const PENDING = '.restore-pending';

async function syncDirectory(directory: string): Promise<void> {
	const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);

	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function replaceFile(from: string, to: string, limit: number): Promise<void> {
	const { handle } = await openBackupFile(from, limit);
	const temporary = `${to}.restore-${crypto.randomUUID()}`;

	try {
		await pipeline(handle.createReadStream(), createWriteStream(temporary, { flags: 'wx', mode: 0o600, flush: true }));
		await rename(temporary, to);
	} finally {
		await handle.close();
		await rm(temporary, { force: true });
	}
}

async function restoreSettings(staged: string, data: string): Promise<void> {
	for (const name of BACKUP_SETTINGS) {
		try {
			await replaceFile(join(staged, name), join(data, name), MAX_SETTINGS_BYTES);
		} catch (error) {
			if (!isMissingFile(error)) throw error;

			await rm(join(data, name), { force: true });
		}
	}
}

function verifySqlite(staged: string, manifest: BackupManifest): void {
	if (manifest.storage !== 'builtin') throw new Error('This backup does not contain a SQLite database.');
	if (sqliteSnapshotVersion(join(staged, SQLITE_SNAPSHOT), true) !== manifest.dataVersion)
		throw new Error('The saved database does not match the backup’s data version.');
}

/** Idempotent: a restart interrupted after replacing a file finishes from the same private staging directory. */
export async function finishSqliteRestore(data: string): Promise<void> {
	const staged = join(data, PENDING);
	let pending;

	try {
		pending = await lstat(staged);
	} catch (error) {
		if (isMissingFile(error)) return;
		throw error;
	}

	if (!pending.isDirectory()) throw new Error('The pending restore is not a regular directory.');

	const manifest = await readManifest(staged);

	assertReadableDataVersion(manifest.dataVersion);
	verifySqlite(staged, manifest);
	await restoreSettings(staged, data);

	for (const suffix of ['-wal', '-shm', '-journal']) await rm(join(data, SQLITE_SNAPSHOT + suffix), { force: true });

	await replaceFile(join(staged, SQLITE_SNAPSHOT), join(data, SQLITE_SNAPSHOT), MAX_DATABASE_BYTES);
	await syncDirectory(data);

	const completed = join(data, `.restore-complete-${crypto.randomUUID()}`);

	await rename(staged, completed);
	await syncDirectory(data);
	await rm(completed, { recursive: true, force: true });
}

/** Run with all Recoder writers stopped; PostgreSQL restore requires a fresh destination. */
export async function restoreBackup(data: string, archive: string, databaseUrl?: string): Promise<BackupManifest> {
	const staged = await mkdtemp(join(data, '.restore-'));

	try {
		const files = await extractArchive(archive, staged);
		const manifest = await readManifest(staged);
		const databaseName = databaseUrl ? POSTGRES_SNAPSHOT : SQLITE_SNAPSHOT;

		assertReadableDataVersion(manifest.dataVersion);

		if (manifest.storage !== (databaseUrl ? 'postgres' : 'builtin') || !files.includes(databaseName))
			throw new Error('The backup was taken from a different storage backend.');

		if (databaseUrl) {
			await restorePostgres(databaseUrl, join(staged, databaseName));
			await restoreSettings(staged, data);

			return manifest;
		}

		verifySqlite(staged, manifest);

		for (const name of files) {
			const handle = await open(join(staged, name), constants.O_RDONLY | constants.O_NOFOLLOW);

			try {
				await handle.sync();
			} finally {
				await handle.close();
			}
		}

		await syncDirectory(staged);
		await rename(staged, join(data, PENDING));
		await syncDirectory(data);
		await finishSqliteRestore(data);

		return manifest;
	} finally {
		await rm(staged, { recursive: true, force: true });
	}
}
