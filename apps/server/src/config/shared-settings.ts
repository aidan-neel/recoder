import { AsyncLocalStorage } from 'node:async_hooks';
import type { SQL, TransactionSQL } from 'bun';
import { z } from 'zod';
import { assertOwnership } from '../review/runtime/ownership';

const settingNameSchema = z.enum([
	'tokens',
	'gitlab-host',
	'review-settings',
	'vllm-servers',
	'global-guidelines',
	'auto-review',
	'watch-state',
	'dismissals',
	'finding-votes',
	'learned-rules'
]);

export type SharedSettingName = z.infer<typeof settingNameSchema>;

const rowSchema = z.object({ name: z.string(), value: z.unknown(), version: z.string().regex(/^[1-9]\d*$/) });

interface SettingSnapshot {
	value: unknown;
	version: string;
}

interface SettingsContext {
	documents: Map<SharedSettingName, SettingSnapshot>;
	changed: Set<SharedSettingName>;
	closed: boolean;
}

const context = new AsyncLocalStorage<SettingsContext>();

export class SharedSettingsConflictError extends Error {
	constructor() {
		super('Settings changed on another replica. Reload the settings and try again.');
		this.name = 'SharedSettingsConflictError';
	}
}

export async function initializeSharedSettings(sql: SQL): Promise<void> {
	await sql.begin(async (transaction) => {
		await transaction`SELECT pg_advisory_xact_lock(hashtext(current_schema()), hashtext('recoder_settings'))`;

		await transaction`CREATE TABLE IF NOT EXISTS recoder_settings (
			name text PRIMARY KEY,
			value jsonb NOT NULL,
			version bigint NOT NULL CHECK (version > 0)
		)`;
	});
}

export function sharedSettingsActive(): boolean {
	return context.getStore() !== undefined;
}

export function readSharedSetting(name: SharedSettingName): unknown {
	const snapshot = context.getStore();

	if (!snapshot || snapshot.closed)
		throw new Error('Read shared settings inside an active withSharedSettings operation.');

	return structuredClone(snapshot.documents.get(name)?.value);
}

export function writeSharedSetting(name: SharedSettingName, value: unknown): void {
	const snapshot = context.getStore();

	if (!snapshot || snapshot.closed)
		throw new Error('Write shared settings inside an active withSharedSettings operation.');

	const previous = snapshot.documents.get(name);

	snapshot.documents.set(name, { value: structuredClone(value), version: previous?.version ?? '0' });
	snapshot.changed.add(name);
}

async function commit(transaction: TransactionSQL, snapshot: SettingsContext): Promise<void> {
	await assertOwnership(transaction);

	for (const name of [...snapshot.changed].sort()) {
		const document = snapshot.documents.get(name)!;
		const encoded = JSON.stringify(document.value);

		if (encoded === undefined) throw new Error(`Shared setting ${name} must be JSON or null.`);

		const rows = await transaction`
				INSERT INTO recoder_settings (name, value, version)
				VALUES (${name}, CAST(${encoded} AS TEXT)::jsonb, 1)
				ON CONFLICT (name) DO UPDATE
				SET value = EXCLUDED.value, version = recoder_settings.version + 1
				WHERE recoder_settings.version = ${document.version}::bigint
				RETURNING version::text
			`;

		if (!rows.length) throw new SharedSettingsConflictError();
	}
}

async function runWithSettings<T>(
	sql: SQL | TransactionSQL,
	work: () => T | Promise<T>,
	save: (snapshot: SettingsContext) => Promise<void>
): Promise<T> {
	const rows = z.array(rowSchema).parse(await sql`SELECT name, value, version::text FROM recoder_settings`);
	const snapshot: SettingsContext = { documents: new Map(), changed: new Set(), closed: false };

	for (const row of rows) {
		const name = settingNameSchema.safeParse(row.name);

		if (name.success) snapshot.documents.set(name.data, { value: row.value, version: row.version });
	}

	return context.run(snapshot, async () => {
		try {
			const result = await work();

			snapshot.closed = true;
			await save(snapshot);

			return result;
		} finally {
			snapshot.closed = true;
		}
	});
}

export function withSharedSettings<T>(sql: SQL, work: () => T | Promise<T>): Promise<T> {
	if (context.getStore()) throw new Error('Shared settings operations must not nest.');

	return withFreshSharedSettings(sql, work);
}

export function withFreshSharedSettings<T>(sql: SQL, work: () => T | Promise<T>): Promise<T> {
	return runWithSettings(sql, work, async (snapshot) => {
		if (snapshot.changed.size) await sql.begin((transaction) => commit(transaction, snapshot));
	});
}

/** The caller owns commit and rollback of both settings and its other database writes. */
export function withSharedSettingsTransaction<T>(transaction: TransactionSQL, work: () => T | Promise<T>): Promise<T> {
	return runWithSettings(transaction, work, (snapshot) => commit(transaction, snapshot));
}
