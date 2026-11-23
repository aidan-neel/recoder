import type { Database } from 'bun:sqlite';
import type { TransactionSQL } from 'bun';

function messageSchema(jsonType: 'TEXT' | 'JSONB'): string {
	return `
		CREATE TABLE IF NOT EXISTS dm_conversations (
			id TEXT PRIMARY KEY NOT NULL,
			first_account_id TEXT NOT NULL,
			second_account_id TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			last_sequence BIGINT NOT NULL DEFAULT 0,
			UNIQUE (first_account_id, second_account_id)
		);
		CREATE INDEX IF NOT EXISTS dm_conversations_second ON dm_conversations (second_account_id);
		CREATE TABLE IF NOT EXISTS dm_messages (
			conversation_id TEXT NOT NULL REFERENCES dm_conversations(id),
			sequence BIGINT NOT NULL,
			id TEXT UNIQUE NOT NULL,
			author_id TEXT NOT NULL,
			client_id TEXT NOT NULL,
			body TEXT NOT NULL,
			attachments ${jsonType} NOT NULL,
			created_at TEXT NOT NULL,
			PRIMARY KEY (conversation_id, sequence),
			UNIQUE (author_id, client_id)
		);
		CREATE INDEX IF NOT EXISTS dm_messages_rate ON dm_messages (author_id, created_at);
		CREATE TABLE IF NOT EXISTS dm_reads (
			conversation_id TEXT NOT NULL REFERENCES dm_conversations(id),
			account_id TEXT NOT NULL,
			read_sequence BIGINT NOT NULL,
			PRIMARY KEY (conversation_id, account_id)
		);
		CREATE TABLE IF NOT EXISTS dm_inbox_cursors (
			account_id TEXT PRIMARY KEY NOT NULL,
			sequence BIGINT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS dm_inbox (
			account_id TEXT NOT NULL REFERENCES dm_inbox_cursors(account_id),
			sequence BIGINT NOT NULL,
			event ${jsonType} NOT NULL,
			PRIMARY KEY (account_id, sequence)
		);
	`;
}

export function initializeSqliteMessages(database: Database): void {
	database.exec(messageSchema('TEXT'));
}

/** The migration ledger and these tables share the schema lock and its transaction. */
export async function initializePostgresMessages(transaction: TransactionSQL): Promise<void> {
	await transaction.unsafe(messageSchema('JSONB')).simple();
}
