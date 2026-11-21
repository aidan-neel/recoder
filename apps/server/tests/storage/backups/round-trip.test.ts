import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARCHIVE_NAME, extractArchive, SQLITE_SNAPSHOT } from '../../../src/storage/backups/archive';
import { finishSqliteRestore, restoreBackup } from '../../../src/storage/backups/restore';
import { createBackup, downloadBackup, findBackup } from '../../../src/storage/backups/store';
import { migrateSqlite } from '../../../src/storage/sqlite-migrations';

let data: string;

beforeEach(async () => {
	data = await mkdtemp(join(tmpdir(), 'recoder-backup-'));
});

afterEach(async () => rm(data, { recursive: true, force: true }));

function openExample(): Database {
	const database = new Database(join(data, SQLITE_SNAPSHOT));

	database.run('PRAGMA journal_mode = WAL');
	migrateSqlite(database, [(connection) => connection.run('CREATE TABLE example (value TEXT)'), () => {}]);

	return database;
}

async function filesOf(stream: ReadableStream<Uint8Array>): Promise<Map<string, File>> {
	const data = await new Response(stream).arrayBuffer();

	return new Bun.Archive(Bun.zstdDecompressSync(data)).files();
}

test('the restore round trip keeps the committed SQLite WAL contents and saved settings', async () => {
	let backupId: string;

	{
		using writer = openExample();

		writer.run("INSERT INTO example VALUES ('before backup')");
		await writeFile(join(data, 'gitlab-host.json'), '{"host":"before.example"}');

		const backup = await createBackup(data, 'manual');

		backupId = backup.id;
		writer.run("UPDATE example SET value = 'after backup'");
	}

	await writeFile(join(data, 'gitlab-host.json'), '{"host":"after.example"}');
	await writeFile(join(data, 'learned-rules.json'), '[]');

	const directory = (await findBackup(data, backupId))!;

	await restoreBackup(data, join(directory, ARCHIVE_NAME));

	using restored = openExample();

	expect(restored.query('SELECT value FROM example').get()).toEqual({ value: 'before backup' });
	expect(await Bun.file(join(data, 'gitlab-host.json')).json()).toEqual({ host: 'before.example' });
	expect(await Bun.file(join(data, 'learned-rules.json')).exists()).toBe(false);
});

test('normal archives exclude credentials keys and opt-in key downloads do not modify the archive', async () => {
	using _database = openExample();

	await writeFile(join(data, 'secret.key'), 'fixture file that must not be archived');
	await writeFile(join(data, 'api-token'), 'fixture bearer that must not be archived');

	const backup = await createBackup(data, 'manual');
	const directory = (await findBackup(data, backup.id))!;
	const explicitKey = Buffer.alloc(32, 7);
	const included = await filesOf(await downloadBackup(directory, explicitKey));

	expect((await included.get('secret.key')?.text())?.trim()).toBe(explicitKey.toString('base64'));

	const normal = await filesOf(await downloadBackup(directory));

	expect(normal.has('api-token')).toBe(false);
	expect(normal.has('secret.key')).toBe(false);
});

test('a settings symlink is not followed into an archive', async () => {
	using _database = openExample();

	await writeFile(join(data, 'private.txt'), 'outside the backup allowlist');
	await symlink(join(data, 'private.txt'), join(data, 'tokens.json'));

	await expect(createBackup(data, 'manual')).rejects.toThrow();
});

test('startup finishes a pending restore using the staged snapshot then retires the journal', async () => {
	let archive: string;

	{
		using writer = openExample();

		writer.run("INSERT INTO example VALUES ('saved')");

		const backup = await createBackup(data, 'manual');
		const directory = (await findBackup(data, backup.id))!;

		archive = join(directory, ARCHIVE_NAME);
		writer.run('DELETE FROM example');
	}

	const pending = join(data, '.restore-pending');

	await mkdir(pending);
	await extractArchive(archive, pending);
	await finishSqliteRestore(data);
	await finishSqliteRestore(data);

	using database = openExample();

	expect(database.query('SELECT value FROM example').get()).toEqual({ value: 'saved' });
	expect(await Bun.file(join(pending, SQLITE_SNAPSHOT)).exists()).toBe(false);
});
