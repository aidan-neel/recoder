import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { Database } from 'bun:sqlite';
import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { initializePostgresStore } from '../../src/storage/postgres';
import { initializeSharedSettings } from '../../src/config/shared-settings';
import { initializeCoordinator } from '../../src/review/runtime/schema';
import { initializePostgresEvents } from '../../src/storage/postgres-events';
import { initializePublication } from '../../src/storage/postgres-publication';
import { importLocalData } from '../../src/storage/import-local';
import { testReview } from '../helpers/review';

const testUrl = process.env.TEST_DATABASE_URL;
const schema = `recoder_import_${crypto.randomUUID().replaceAll('-', '')}`;
let admin: SQL;
let sql: SQL;
const sources: string[] = [];
const connections: Database[] = [];

beforeAll(async () => {
	if (!testUrl) return;

	admin = new SQL(testUrl);
	await admin.unsafe(`CREATE SCHEMA ${schema}`);
	sql = new SQL(testUrl, { connection: { search_path: schema } });
	await initializePostgresStore(sql);
	await initializeSharedSettings(sql);
	await initializeCoordinator(sql);
	await initializePostgresEvents(sql);
	await initializePublication(sql);
});

beforeEach(async () => {
	if (!testUrl) return;

	await sql`TRUNCATE recoder_records, recoder_settings, review_actor_leases, review_actor_commands, recoder_review_events, recoder_publications CASCADE`;
});

afterAll(async () => {
	for (const database of connections) database.close();
	await Promise.all(sources.map((directory) => rm(directory, { recursive: true, force: true })));
	if (!testUrl) return;

	await sql.close();
	await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
	await admin.close();
});

async function source(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'recoder-import-test-'));

	sources.push(directory);

	return directory;
}

async function hashes(directory: string): Promise<Record<string, string>> {
	const result: Record<string, string> = {};

	for (const name of await readdir(directory))
		result[name] = new Bun.CryptoHasher('sha256')
			.update(await Bun.file(join(directory, name)).arrayBuffer())
			.digest('hex');

	return result;
}

const integration = test.skipIf(!testUrl);

integration('import preserves committed WAL reviews, paused recovery, settings, and source bytes', async () => {
	const directory = await source();
	const database = new Database(join(directory, 'recoder.db'));

	connections.push(database);
	database.exec('PRAGMA journal_mode = WAL');
	database.exec('CREATE TABLE reviews (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
	database.exec('CREATE TABLE review_progress (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
	database.exec('CREATE TABLE review_diffs (review_id TEXT PRIMARY KEY, diff TEXT NOT NULL)');

	const review = testReview({ id: 'migrated-review', status: 'running' });

	database.query('INSERT INTO reviews VALUES (?, ?)').run(review.id, JSON.stringify(review));

	database.query('INSERT INTO review_progress VALUES (?, ?)').run(
		review.id,
		JSON.stringify({
			id: review.id,
			sequence: 3,
			paused: true,
			messages: [{ id: 'reply-1', text: 'Partial reply', discussion: true, status: 'streaming' }],
			reasoning: [{ id: 'reason_reply-1', text: 'Partial reasoning', status: 'streaming' }]
		})
	);

	database.query('INSERT INTO review_diffs VALUES (?, ?)').run(review.id, 'synthetic diff');
	await writeFile(join(directory, 'tokens.json'), JSON.stringify({ github: 'synthetic-test-token' }));
	await writeFile(join(directory, 'review-guidelines.md'), '');

	await writeFile(
		join(directory, 'review-config.json'),
		JSON.stringify({
			subagentCap: 4,
			models: [{ label: 'Test model', model: 'test-model' }]
		})
	);

	const before = await hashes(directory);
	const result = await importLocalData(sql, directory);

	const records = await sql<
		{ collection: string; value: Record<string, unknown> }[]
	>`SELECT collection, value FROM recoder_records ORDER BY position`;

	const documents = await sql<
		{ name: string; value: Record<string, unknown> }[]
	>`SELECT name, value FROM recoder_settings`;

	const actor = await sql<
		{ desired_state: string; pending: boolean }[]
	>`SELECT desired_state, pending FROM review_actor_leases WHERE review_id = ${review.id}`;

	expect(result).toEqual({ records: 3, settings: 3 });
	expect(records.find((row) => row.collection === 'reviews')?.value).toEqual({ ...review });
	expect(records.find((row) => row.collection === 'review_diffs')?.value.diff).toBe('synthetic diff');

	expect(records.find((row) => row.collection === 'review_progress')?.value).toMatchObject({
		paused: true,
		messages: [{ id: 'reply-1', status: 'error' }],
		reasoning: [{ id: 'reason_reply-1', status: 'error' }]
	});

	expect(actor[0]).toEqual({ desired_state: 'paused', pending: true });
	expect(documents.find((row) => row.name === 'global-guidelines')?.value.content).toBe('');
	expect(documents.some((row) => row.name === 'auto-review')).toBe(false);

	expect(documents.find((row) => row.name === 'review-settings')?.value).toMatchObject({
		subagentCap: 8,
		models: [{ id: expect.any(String), model: 'test-model' }]
	});

	expect(await hashes(directory)).toEqual(before);
});

integration('a populated destination refuses import without changing existing records', async () => {
	const directory = await source();

	await writeFile(join(directory, 'tokens.json'), '{}');
	await sql`INSERT INTO recoder_records (collection, id, value) VALUES ('reviews', 'existing', '{"id":"existing"}'::jsonb)`;
	await expect(importLocalData(sql, directory)).rejects.toThrow('destination contains Recoder data');
	expect(await sql<unknown[]>`SELECT value FROM recoder_records`).toEqual([{ value: { id: 'existing' } }]);
	expect(await sql<unknown[]>`SELECT name FROM recoder_settings`).toEqual([]);
});

integration('invalid settings roll back previously imported database records', async () => {
	const directory = await source();
	const database = new Database(join(directory, 'recoder.db'));

	database.exec('CREATE TABLE reviews (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
	database.query('INSERT INTO reviews VALUES (?, ?)').run('valid', JSON.stringify(testReview({ id: 'valid' })));
	database.close();

	for (const invalid of [{ github: 42 }, null]) {
		await writeFile(join(directory, 'tokens.json'), JSON.stringify(invalid));
		await expect(importLocalData(sql, directory)).rejects.toThrow('invalid');
		expect(await sql<unknown[]>`SELECT id FROM recoder_records`).toEqual([]);
		expect(await sql<unknown[]>`SELECT name FROM recoder_settings`).toEqual([]);
	}
});

integration('settings symlinks cannot read outside the explicitly selected source directory', async () => {
	const directory = await source();
	const outside = await source();

	await writeFile(join(outside, 'outside.json'), '{}');
	await symlink(join(outside, 'outside.json'), join(directory, 'tokens.json'));
	await expect(importLocalData(sql, directory)).rejects.toThrow('outside the selected directory');
	expect(await sql<unknown[]>`SELECT name FROM recoder_settings`).toEqual([]);
});

integration('a host environment override cannot hide an invalid saved GitLab document', async () => {
	const directory = await source();
	const previous = process.env.GITLAB_HOST;

	await writeFile(join(directory, 'gitlab-host.json'), JSON.stringify({ host: 42 }));
	process.env.GITLAB_HOST = 'gitlab.example.test';

	try {
		await expect(importLocalData(sql, directory)).rejects.toThrow('source settings document is invalid');
		expect(await sql<unknown[]>`SELECT name FROM recoder_settings`).toEqual([]);
	} finally {
		if (previous === undefined) delete process.env.GITLAB_HOST;
		else process.env.GITLAB_HOST = previous;
	}
});

integration('the explicit import command initializes an empty database and reports only counts', async () => {
	if (!testUrl) return;

	const directory = await source();
	const name = `recoder_import_cli_${crypto.randomUUID().replaceAll('-', '')}`;
	const destination = new URL(testUrl);

	destination.pathname = `/${name}`;
	await writeFile(join(directory, 'tokens.json'), '{}');
	await admin.unsafe(`CREATE DATABASE ${name}`);

	try {
		const command = Bun.spawn([process.execPath, 'apps/server/src/storage/import-local.ts', '--source', directory], {
			cwd: resolve(import.meta.dir, '../../../..'),
			env: { ...process.env, RECODER_DATABASE_URL: destination.href, RECODER_DATA_DIR: directory },
			stdout: 'pipe',
			stderr: 'pipe'
		});

		const timeout = setTimeout(() => command.kill('SIGKILL'), 10_000);

		const [output, errors, code] = await Promise.all([
			new Response(command.stdout).text(),
			new Response(command.stderr).text(),
			command.exited
		]);

		clearTimeout(timeout);
		expect({ code, errors }).toEqual({ code: 0, errors: '' });
		expect(output.trim()).toBe('Imported 0 records and 1 settings documents.');
		expect(output).not.toContain(destination.href);
	} finally {
		await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
	}
});
