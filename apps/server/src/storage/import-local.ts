import { Database } from 'bun:sqlite';
import type { SQL, TransactionSQL } from 'bun';
import { constants } from 'node:fs';
import { copyFile, mkdtemp, open, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { withSharedSettingsTransaction, writeSharedSetting, type SharedSettingName } from '../config/shared-settings';
import { initTokenStore } from '../forge/tokens';
import { readStoredGitlabHost } from '../forge/gitlab-host';
import { readAutoReviewSettings } from '../forge/watch/settings';
import { readWatchState } from '../forge/watch/cursor';
import { listVllmServers } from '../models/vllm/vllm-store';
import { readGlobalGuidelines } from '../review/guidelines/guidelines';
import { listDismissals } from '../review/guidelines/learned/dismissals';
import { topicTallies } from '../review/guidelines/learned/votes';
import { getStoredSettings, parseSavedReviewSettings } from '../review/session/review-settings';
import { enqueueActor, enqueueCommand } from '../review/runtime/inbox';

const MAX_DATABASE_BYTES = 1024 * 1024 * 1024;
const MAX_SETTING_BYTES = 4 * 1024 * 1024;
const MAX_RECORD_BYTES = 64 * 1024 * 1024;
const MAX_RECORDS = 100_000;

const collections = [
	'repos',
	'reviews',
	'runs',
	'review_progress',
	'review_metrics',
	'review_checkpoints',
	'review_replays'
] as const;

const recordSchema = z.object({ id: z.string().min(1).max(200) }).passthrough();
const rowSchema = z.object({ id: z.string().min(1).max(200), value: z.string() });
const diffSchema = z.object({ review_id: z.string().min(1).max(200), diff: z.string() });

const progressSchema = recordSchema.extend({
	paused: z.boolean().optional(),
	messages: z
		.array(
			z
				.object({ id: z.string(), text: z.string(), status: z.string().optional(), discussion: z.boolean().optional() })
				.passthrough()
		)
		.optional(),
	reasoning: z.array(z.object({ id: z.string(), status: z.string().optional() }).passthrough()).optional()
});

const settings: { name: SharedSettingName; file: string }[] = [
	{ name: 'tokens', file: 'tokens.json' },
	{ name: 'gitlab-host', file: 'gitlab-host.json' },
	{ name: 'review-settings', file: 'review-config.json' },
	{ name: 'vllm-servers', file: 'vllm-servers.json' },
	{ name: 'global-guidelines', file: 'review-guidelines.md' },
	{ name: 'auto-review', file: 'auto-review.json' },
	{ name: 'watch-state', file: 'auto-review-state.json' },
	{ name: 'dismissals', file: 'dismissed-findings.json' },
	{ name: 'finding-votes', file: 'finding-votes.json' }
];

async function sourceFile(directory: string, name: string, limit: number): Promise<string | undefined> {
	let path: string;

	try {
		path = await realpath(join(directory, name));
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
		throw error;
	}

	const confined = relative(directory, path);

	if (isAbsolute(confined) || confined === '..' || confined.startsWith('../'))
		throw new Error(`Source file ${name} resolves outside the selected directory.`);

	const file = await stat(path);

	if (!file.isFile() || file.size > limit)
		throw new Error(`Source file ${name} must be a regular file no larger than ${limit} bytes.`);

	return path;
}

async function readSettings(directory: string): Promise<{ name: SharedSettingName; value: unknown }[]> {
	const documents: { name: SharedSettingName; value: unknown }[] = [];

	for (const setting of settings) {
		const path = await sourceFile(directory, setting.file, MAX_SETTING_BYTES);

		if (!path) continue;

		const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);

		try {
			const info = await file.stat();
			const text = await file.readFile('utf8');

			if (Buffer.byteLength(text) > MAX_SETTING_BYTES)
				throw new Error(`Source file ${setting.file} grew during import. Stop its writer and retry.`);

			let value: unknown;

			try {
				value =
					setting.name === 'global-guidelines'
						? { content: text, updatedAt: info.mtime.toISOString() }
						: JSON.parse(text);

				if (value === null) throw new Error('A saved settings file cannot contain a null document.');

				if (setting.name === 'review-settings') value = parseSavedReviewSettings(value).settings;
			} catch {
				throw new Error(`Source file ${setting.file} is invalid. Repair it before importing.`);
			}

			documents.push({ name: setting.name, value });
		} finally {
			await file.close();
		}
	}

	return documents;
}

async function copySnapshot(directory: string, target: string): Promise<boolean> {
	let found = false;

	for (const name of ['recoder.db', 'recoder.db-wal', 'recoder.db-shm', 'recoder.db-journal']) {
		const path = await sourceFile(directory, name, MAX_DATABASE_BYTES);

		if (!path) continue;

		const before = await stat(path);

		await copyFile(path, join(target, name));

		const after = await stat(path);

		if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
			throw new Error('The source database changed during import. Stop the source server and retry.');
		if (name === 'recoder.db') found = true;
	}

	return found;
}

async function requireEmptyDestination(transaction: TransactionSQL): Promise<void> {
	await transaction`SELECT pg_advisory_xact_lock(hashtextextended('recoder:local-import', 0))`;

	const tables = [
		'recoder_records',
		'recoder_settings',
		'review_actor_leases',
		'review_actor_commands',
		'recoder_review_events',
		'recoder_publications'
	];

	for (const table of tables) {
		const existing = await transaction<{ name: string | null }[]>`SELECT to_regclass(${table})::text AS name`;

		if (!existing[0]?.name) continue;

		await transaction.unsafe(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);

		const rows = await transaction.unsafe<unknown[]>(`SELECT 1 FROM ${table} LIMIT 1`);

		if (rows.length)
			throw new Error(
				'The destination contains Recoder data. Import into an empty database; existing data is never overwritten.'
			);
	}
}

function validateSharedSettings(): void {
	initTokenStore();
	readStoredGitlabHost();
	getStoredSettings();
	listVllmServers();
	readGlobalGuidelines();
	readAutoReviewSettings();
	readWatchState();
	listDismissals('');
	topicTallies('');
}

async function importRecords(transaction: TransactionSQL, database: Database): Promise<number> {
	const tables = new Set(
		database
			.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
			.all()
			.map((row) => row.name)
	);

	let imported = 0;
	const recovering = new Set<string>();

	const save = async (collection: string, id: string, value: unknown) => {
		if (++imported > MAX_RECORDS)
			throw new Error(`Source database exceeds ${MAX_RECORDS} records. Split the migration before importing.`);

		await transaction`
			INSERT INTO recoder_records (collection, id, value)
			VALUES (${collection}, ${id}, ${JSON.stringify(value)}::text::jsonb)
		`;
	};

	for (const collection of collections) {
		if (!tables.has(collection)) continue;

		const oversized = database
			.query<{ oversized: number }, [number]>(
				`SELECT 1 AS oversized FROM ${collection} WHERE length(CAST(value AS BLOB)) > ? LIMIT 1`
			)
			.get(MAX_RECORD_BYTES);

		if (oversized) throw new Error(`A ${collection} record exceeds ${MAX_RECORD_BYTES} bytes.`);

		for (const raw of database.query<unknown, []>(`SELECT id, value FROM ${collection} ORDER BY rowid`).iterate()) {
			const row = rowSchema.parse(raw);

			if (Buffer.byteLength(row.value) > MAX_RECORD_BYTES)
				throw new Error(`A ${collection} record exceeds ${MAX_RECORD_BYTES} bytes.`);

			let value = recordSchema.parse(JSON.parse(row.value));

			if (value.id !== row.id) throw new Error(`A ${collection} record has an inconsistent id.`);

			if (collection === 'review_progress') {
				const progress = progressSchema.parse(value);
				const interrupted = new Set<string>();

				progress.messages = progress.messages?.map((message) => {
					if (!message.discussion || message.status !== 'streaming') return message;

					interrupted.add(`reason_${message.id}`);

					return {
						...message,
						status: 'error',
						text: `${message.text}${message.text ? '\n\n' : ''}Reply interrupted by migration. Send a new message to retry.`
					};
				});

				progress.reasoning = progress.reasoning?.map((entry) =>
					interrupted.has(entry.id) && entry.status === 'streaming' ? { ...entry, status: 'error' } : entry
				);

				value = progress;
				if (progress.paused && recovering.has(row.id))
					await enqueueCommand(transaction, row.id, { id: 'import-pause', kind: 'pause' });
			}

			await save(collection, row.id, value);

			if (collection === 'reviews' && (value.status === 'queued' || value.status === 'running')) {
				recovering.add(row.id);
				await enqueueActor(transaction, row.id);
			}
		}
	}

	if (tables.has('review_diffs')) {
		const oversized = database
			.query<{ oversized: number }, [number]>(
				'SELECT 1 AS oversized FROM review_diffs WHERE length(CAST(diff AS BLOB)) > ? LIMIT 1'
			)
			.get(MAX_RECORD_BYTES);

		if (oversized) throw new Error(`A review diff exceeds ${MAX_RECORD_BYTES} bytes.`);

		for (const raw of database
			.query<unknown, []>('SELECT review_id, diff FROM review_diffs ORDER BY rowid')
			.iterate()) {
			const row = diffSchema.parse(raw);

			if (Buffer.byteLength(row.diff) > MAX_RECORD_BYTES)
				throw new Error(`A review diff exceeds ${MAX_RECORD_BYTES} bytes.`);
			await save('review_diffs', row.review_id, { id: row.review_id, diff: row.diff });
		}
	}

	return imported;
}

export async function importLocalData(
	sql: SQL,
	sourceDirectory: string
): Promise<{ records: number; settings: number }> {
	const directory = await realpath(sourceDirectory);
	const snapshot = await mkdtemp(join(tmpdir(), 'recoder-import-'));
	let database: Database | undefined;

	try {
		const documents = await readSettings(directory);
		const hasDatabase = await copySnapshot(directory, snapshot);

		if (!hasDatabase && !documents.length)
			throw new Error('The selected directory contains no Recoder database or settings.');

		if (hasDatabase) {
			database = new Database(join(snapshot, 'recoder.db'), { readonly: true });
			database.exec('BEGIN');
		}

		return await sql.begin(async (transaction) => {
			await requireEmptyDestination(transaction);

			const records = database ? await importRecords(transaction, database) : 0;

			await withSharedSettingsTransaction(transaction, () => {
				for (const document of documents) writeSharedSetting(document.name, document.value);

				try {
					validateSharedSettings();
				} catch {
					throw new Error('A source settings document is invalid. Repair the source before importing.');
				}
			});

			return { records, settings: documents.length };
		});
	} finally {
		database?.close();
		await rm(snapshot, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	try {
		const args = parseArgs({ args: process.argv.slice(2), options: { source: { type: 'string' } }, strict: true });

		if (!args.values.source) throw new Error('Pass --source <directory> for the stopped Recoder data directory.');

		const { postgres, initializeStorage } = await import('./backend');

		if (!postgres) throw new Error('Set RECODER_DATABASE_URL to the empty destination PostgreSQL database.');

		try {
			await initializeStorage();

			const result = await importLocalData(postgres, args.values.source);

			console.log(`Imported ${result.records} records and ${result.settings} settings documents.`);
		} finally {
			await postgres.close();
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : 'The local data import failed.');
		process.exitCode = 1;
	}
}
