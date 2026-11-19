import { createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { z } from 'zod';
import type { Backup, BackupReason } from '@recoder/shared';
import { VERSION } from '../../version';
import { assertReadableDataVersion } from '../data-version';
import {
	ARCHIVE_NAME,
	BACKUP_SETTINGS,
	extractArchive,
	MANIFEST_NAME,
	MAX_ARCHIVE_BYTES,
	MAX_SETTINGS_BYTES,
	openBackupFile,
	POSTGRES_SNAPSHOT,
	readManifest,
	SQLITE_SNAPSHOT,
	writeArchive,
	type BackupManifest
} from './archive';
import { snapshotSqlite, sqliteSnapshotVersion } from './sqlite-snapshot';
import { snapshotPostgres } from './postgres-snapshot';

const backupId = z.uuid();

export function isMissingFile(error: unknown): boolean {
	return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

export async function backupRoot(data: string): Promise<string> {
	const root = join(data, 'backups');

	await mkdir(root, { mode: 0o700, recursive: true });

	if (!(await lstat(root)).isDirectory()) throw new Error('The backup location is not a regular directory.');

	return root;
}

export async function findBackup(data: string, id: string): Promise<string | undefined> {
	if (!backupId.safeParse(id).success) return;

	const directory = join(await backupRoot(data), id);

	try {
		if ((await lstat(directory)).isDirectory()) return directory;
	} catch (error) {
		if (!isMissingFile(error)) throw error;
	}
}

export async function describeBackup(directory: string): Promise<Backup> {
	const manifest = await readManifest(directory);
	const { handle, stat } = await openBackupFile(join(directory, ARCHIVE_NAME), MAX_ARCHIVE_BYTES);

	await handle.close();

	return {
		id: manifest.id,
		reason: manifest.reason,
		createdAt: manifest.createdAt,
		version: manifest.version,
		dataVersion: manifest.dataVersion,
		sizeBytes: stat.size
	};
}

async function copySettings(data: string, snapshot: string): Promise<string[]> {
	const files: string[] = [];

	for (const name of BACKUP_SETTINGS) {
		try {
			const { handle, stat } = await openBackupFile(join(data, name), MAX_SETTINGS_BYTES);

			try {
				const content = await handle.readFile();
				const after = await handle.stat();

				if (after.mtimeMs !== stat.mtimeMs || content.byteLength !== stat.size)
					throw new Error('Settings changed during the backup. Retry to capture the latest settings.');

				await writeFile(join(snapshot, name), content, { mode: 0o600, flag: 'wx' });
				files.push(name);
			} finally {
				await handle.close();
			}
		} catch (error) {
			if (!isMissingFile(error)) throw error;
		}
	}

	return files;
}

/** Publishes only complete archives. The credentials key and local bearer token stay outside the archive. */
export async function createBackup(data: string, reason: BackupReason, databaseUrl?: string): Promise<Backup> {
	const root = await backupRoot(data);
	const staging = await mkdtemp(join(root, '.creating-'));
	const snapshot = join(staging, 'snapshot');
	const output = join(staging, 'output');
	const database = databaseUrl ? POSTGRES_SNAPSHOT : SQLITE_SNAPSHOT;
	const destination = join(snapshot, database);

	try {
		await Promise.all([mkdir(snapshot, { mode: 0o700 }), mkdir(output, { mode: 0o700 })]);

		const dataVersion = databaseUrl
			? await snapshotPostgres(databaseUrl, destination)
			: await snapshotLocal(data, destination);

		assertReadableDataVersion(dataVersion);

		const manifest: BackupManifest = {
			format: 1,
			id: crypto.randomUUID(),
			createdAt: new Date().toISOString(),
			reason,
			version: VERSION,
			dataVersion,
			storage: databaseUrl ? 'postgres' : 'builtin'
		};

		const settings = await copySettings(data, snapshot);
		const metadata = JSON.stringify(manifest);

		await writeFile(join(snapshot, MANIFEST_NAME), metadata, { flag: 'wx', mode: 0o600 });

		await writeArchive(
			snapshot,
			[MANIFEST_NAME, database, ...settings],
			createWriteStream(join(output, ARCHIVE_NAME), { flags: 'wx', mode: 0o600, flush: true })
		);

		await writeFile(join(output, MANIFEST_NAME), metadata, { flag: 'wx', mode: 0o600, flush: true });

		const backup = await describeBackup(output);

		await rename(output, join(root, manifest.id));

		return backup;
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

async function snapshotLocal(data: string, destination: string): Promise<number> {
	await snapshotSqlite(join(data, SQLITE_SNAPSHOT), destination);

	return sqliteSnapshotVersion(destination);
}

/** Decrypts nothing and never writes the requested plaintext key back to the backup store. */
export async function downloadBackup(directory: string, key?: Buffer): Promise<ReadableStream<Uint8Array>> {
	const source = join(directory, ARCHIVE_NAME);

	if (!key) {
		const { handle } = await openBackupFile(source, MAX_ARCHIVE_BYTES);

		return Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>;
	}

	const staged = await mkdtemp(join(dirname(directory), '.download-'));

	try {
		const files = await extractArchive(source, staged);
		const stream = new PassThrough();

		void writeArchive(staged, files, stream, key)
			.catch((error: Error) => stream.destroy(error))
			.finally(() => rm(staged, { recursive: true, force: true }))
			.catch(() => {});

		return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
	} catch (error) {
		await rm(staged, { recursive: true, force: true });
		throw error;
	}
}
