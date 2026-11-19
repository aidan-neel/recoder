import { SQL } from 'bun';
import { stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { within, type ServerOverview, type StorageStatus, type StorageTest } from '@recoder/shared';
import { env } from '../../env';
import { collection, postgres, storageTransaction } from '../../storage/backend';
import { sqlite } from '../../storage/sqlite';
import { serverDataDir } from '../../util/data-dir';

export function postgresConnectionUrl(input: string): URL | null {
	const url = URL.parse(input);

	return url?.hostname && (url.protocol === 'postgres:' || url.protocol === 'postgresql:') ? url : null;
}

export function storageIdentity(): Omit<StorageStatus, 'sizeBytes'> {
	if (!postgres) return { kind: 'builtin' };

	const url = env.RECODER_DATABASE_URL ? postgresConnectionUrl(env.RECODER_DATABASE_URL) : null;
	const database = url?.pathname.slice(1);
	const location = url ? (database ? `${url.host}/${database}` : url.host) : undefined;

	return { kind: 'postgres', location };
}

export async function storageStatus(): Promise<StorageStatus> {
	const identity = storageIdentity();

	try {
		if (postgres) {
			const [row] = await postgres<{ bytes: number }[]>`SELECT pg_database_size(current_database())::float8 AS bytes`;

			return { ...identity, sizeBytes: row?.bytes ?? null };
		}

		const { size } = await stat(join(serverDataDir(), 'recoder.db'));

		return { ...identity, sizeBytes: size };
	} catch {
		return { ...identity, sizeBytes: null };
	}
}

export async function diskStatus(): Promise<ServerOverview['disk']> {
	try {
		const { bavail, blocks, bsize } = await statfs(serverDataDir());

		return { freeBytes: bavail * bsize, totalBytes: blocks * bsize };
	} catch {
		return null;
	}
}

export async function probeDatabaseWrite(): Promise<void> {
	const id = `deploy:database-probe:${crypto.randomUUID()}`;

	if (postgres) {
		const probes = collection<{ id: string }>('update_state');

		await storageTransaction(async () => {
			await probes.set({ id });
			await probes.delete(id);
		});

		return;
	}

	const database = sqlite();

	database
		.transaction(() => {
			database.query("INSERT INTO update_state (id, value) VALUES (?, '{}')").run(id);
			database.query('DELETE FROM update_state WHERE id = ?').run(id);
		})
		.immediate();
}

async function probePostgres(url: string): Promise<string> {
	const connection = new SQL(url, {
		max: 1,
		connectionTimeout: 4,
		connection: { statement_timeout: 4000 }
	});

	try {
		const rows = connection<{ server_version: string }[]>`SHOW server_version`;
		const [row] = await within(Promise.resolve(rows), 8000, []);

		return row?.server_version ?? '';
	} finally {
		await connection.close({ timeout: 0 });
	}
}

export async function testPostgres(
	url: string,
	connect: (url: string) => Promise<string> = probePostgres
): Promise<StorageTest> {
	try {
		const version = /^(\d{1,3}(?:\.\d{1,3}){0,2})(?=\s|$)/.exec(await connect(url))?.[1];

		if (version) return { ok: true, version };
	} catch {}

	return { ok: false, error: 'Could not connect to PostgreSQL. Check the address, credentials and network access.' };
}
