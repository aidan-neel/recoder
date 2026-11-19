import { ZstdCompress, ZstdDecompress } from 'node:zlib';
import { constants, createWriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extract, pack, type Header } from 'tar-stream';
import { z } from 'zod';
import { localSettings } from '../local-settings';

export const SQLITE_SNAPSHOT = 'recoder.db';
export const POSTGRES_SNAPSHOT = 'recoder.pg-dump';
export const MANIFEST_NAME = 'manifest.json';
export const ARCHIVE_NAME = 'backup.tar.zst';

const KEY_NAME = 'secret.key';

export const MAX_SETTINGS_BYTES = 32 * 1024 * 1024;
export const MAX_DATABASE_BYTES = 64 * 1024 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = MAX_DATABASE_BYTES + MAX_SETTINGS_BYTES * localSettings.length;

/** Caches, worktrees, live login files and the local bearer token are deliberately not copied. */
export const BACKUP_SETTINGS = localSettings.map(({ file }) => file);

const manifestSchema = z.object({
	format: z.literal(1),
	id: z.uuid(),
	createdAt: z.iso.datetime(),
	reason: z.enum(['manual', 'nightly', 'update']),
	version: z.string().min(1).max(100),
	dataVersion: z.number().int().nonnegative(),
	storage: z.enum(['builtin', 'postgres'])
});

export type BackupManifest = z.infer<typeof manifestSchema>;

/** Reads only regular files, without following the final component or blocking on pipes. */
export async function openBackupFile(path: string, maximum: number) {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

	try {
		const stat = await handle.stat();

		if (!stat.isFile() || stat.size > maximum) throw new Error('A backup file is missing or exceeds its size limit.');

		return { handle, stat };
	} catch (error) {
		await handle.close();
		throw error;
	}
}

function maximumSize(name: string): number | undefined {
	if (name === SQLITE_SNAPSHOT || name === POSTGRES_SNAPSHOT) return MAX_DATABASE_BYTES;
	if (name === KEY_NAME) return 128;
	if (name === MANIFEST_NAME) return 4096;
	if (BACKUP_SETTINGS.includes(name)) return MAX_SETTINGS_BYTES;

	return undefined;
}

/** Streams the compressed archive to disk or directly to the authenticated download. */
export async function writeArchive(
	directory: string,
	filenames: string[],
	destination: Writable,
	key?: Buffer
): Promise<void> {
	const tar = pack();
	const writing = pipeline(tar, new ZstdCompress(), destination);

	const adding = (async () => {
		for (const name of filenames) {
			const sizeLimit = maximumSize(name);

			if (sizeLimit === undefined || name === KEY_NAME) throw new Error('Invalid backup entry.');

			const { handle, stat } = await openBackupFile(join(directory, name), sizeLimit);

			try {
				await pipeline(handle.createReadStream(), tar.entry({ name, size: stat.size, mode: 0o600 }));
			} finally {
				await handle.close();
			}
		}

		if (key) tar.entry({ name: KEY_NAME, mode: 0o600 }, `${key.toString('base64')}\n`);
		tar.finalize();
	})();

	try {
		await Promise.all([writing, adding]);
	} finally {
		tar.destroy();
	}
}

function validateHeader(header: Header, filenames: Set<string>): void {
	const limit = maximumSize(header.name);

	if (
		limit === undefined ||
		header.type !== 'file' ||
		header.linkname ||
		header.size === undefined ||
		!Number.isSafeInteger(header.size) ||
		header.size < 0 ||
		header.size > limit ||
		filenames.has(header.name)
	) {
		throw new Error('The archive contains an invalid or duplicate backup entry.');
	}
}

/** Extracts only one of each expected regular file into a private staging directory; never restores a key. */
export async function extractArchive(source: string, directory: string): Promise<string[]> {
	const tar = extract();
	const filenames = new Set<string>();
	const input = await openBackupFile(source, MAX_ARCHIVE_BYTES);

	tar.on('entry', (header, stream, next) => {
		try {
			validateHeader(header, filenames);
			filenames.add(header.name);

			if (header.name === KEY_NAME) {
				stream.once('end', next);
				stream.resume();

				return;
			}

			void pipeline(stream, createWriteStream(join(directory, header.name), { flags: 'wx', mode: 0o600 })).then(
				() => next(),
				(error: Error) => tar.destroy(error)
			);
		} catch (error) {
			tar.destroy(error as Error);
		}
	});

	try {
		await pipeline(input.handle.createReadStream(), new ZstdDecompress(), tar);
	} finally {
		await input.handle.close();
	}

	filenames.delete(KEY_NAME);

	return [...filenames];
}

export async function readManifest(directory: string): Promise<BackupManifest> {
	const file = await openBackupFile(join(directory, MANIFEST_NAME), 4096);

	try {
		return manifestSchema.parse(JSON.parse(await file.handle.readFile('utf8')));
	} finally {
		await file.handle.close();
	}
}
