import type { Database } from 'bun:sqlite';
import type { TransactionSQL } from 'bun';

/** Explicit columns and dependency order; nothing from the source schema becomes SQL in the destination. */
const messageColumns = {
	dm_conversations: ['id', 'first_account_id', 'second_account_id', 'created_at', 'updated_at', 'last_sequence'],
	dm_messages: ['conversation_id', 'sequence', 'id', 'author_id', 'client_id', 'body', 'attachments', 'created_at'],
	dm_reads: ['conversation_id', 'account_id', 'read_sequence'],
	dm_inbox_cursors: ['account_id', 'sequence'],
	dm_inbox: ['account_id', 'sequence', 'event']
} as const;

export const messageTables = Object.keys(messageColumns);

export async function importLocalMessages(
	transaction: TransactionSQL,
	database: Database,
	tables: ReadonlySet<string>,
	limits: { rows: number; rowBytes: number }
): Promise<number> {
	let imported = 0;

	for (const [table, columns] of Object.entries(messageColumns)) {
		if (!tables.has(table)) continue;

		const names = columns.join(', ');

		const placeholders = columns.map((name, index) => {
			const parameter = `$${index + 1}`;

			return name === 'attachments' || name === 'event' ? `CAST(CAST(${parameter} AS TEXT) AS JSONB)` : parameter;
		});

		const insert = `INSERT INTO ${table} (${names}) VALUES (${placeholders.join(', ')})`;

		for (const row of database.query<Record<string, unknown>, []>(`SELECT ${names} FROM ${table}`).iterate()) {
			if (++imported > limits.rows) throw new Error('The source database exceeds the import record limit.');

			let bytes = 0;

			const values = columns.map((name) => {
				const value = row[name];

				if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
				if (typeof value !== 'string' || value.includes('\0')) throw new Error('Invalid direct message record.');

				bytes += Buffer.byteLength(value);

				return value;
			});

			if (bytes > limits.rowBytes) throw new Error('A direct message record exceeds the import size limit.');
			await transaction.unsafe(insert, values);
		}
	}

	return imported;
}
