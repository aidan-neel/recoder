import { Database } from 'bun:sqlite';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The tables `agy` 1.5.6 keeps in `conversation_summaries.db`, which the fake CLI and the seeding below create. */
export const SUMMARIES_SCHEMA_SQL = [
	'CREATE TABLE IF NOT EXISTS conversation_parents (conversation_id TEXT PRIMARY KEY, parent_id TEXT NOT NULL) WITHOUT ROWID;',
	'CREATE TABLE IF NOT EXISTS conversation_summaries (conversation_id text, title text NOT NULL DEFAULT "", preview text NOT NULL DEFAULT "", step_count integer NOT NULL DEFAULT 0, last_modified_time datetime NOT NULL, workspace_uris text NOT NULL, status text NOT NULL DEFAULT "", source text NOT NULL DEFAULT "", project_id text NOT NULL DEFAULT "", agent_name text NOT NULL DEFAULT "", parent_conversation_id text NOT NULL DEFAULT "", nesting_depth integer NOT NULL DEFAULT 0, battle_id text NOT NULL DEFAULT "", winning_conversation_id text NOT NULL DEFAULT "", not_fully_idle numeric NOT NULL DEFAULT false, killed numeric NOT NULL DEFAULT false, last_user_input_time datetime NOT NULL, last_user_input_step_index integer NOT NULL DEFAULT -1, app_data_dir text NOT NULL DEFAULT "", raw_summary blob, group_id text NOT NULL DEFAULT "", PRIMARY KEY (conversation_id));',
	"CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(conversation_id UNINDEXED, chunk_index UNINDEXED, chunk_first_step UNINDEXED, chunk_last_step UNINDEXED, last_modified_time UNINDEXED, step_count UNINDEXED, last_step_created_at UNINDEXED, archived UNINDEXED, user_step_byte_offsets UNINDEXED, agent_step_byte_offsets UNINDEXED, title, workspace, project, user_body, agent_body, tokenize = 'unicode61 remove_diacritics 2', prefix = '1 2 3');"
].join('\n');

/** Per-conversation files under `home` where `agy` stores SQLite state, annotations, presence lock and brain dir. */
export function savedConversationPaths(home: string, conversationId: string): string[] {
	const base = join(home, '.gemini', 'antigravity-cli');

	return [
		join(base, 'conversations', `${conversationId}.db`),
		join(base, 'annotations', `${conversationId}.pbtxt`),
		join(base, 'presence', `${conversationId}.lock`),
		join(base, 'brain', conversationId)
	];
}

function protoLengthField(fieldNumber: number, payload: Buffer): Buffer {
	const header: number[] = [];
	let remaining = payload.length;

	header.push((fieldNumber << 3) | 2);

	while (remaining >= 0x80) {
		header.push((remaining & 0x7f) | 0x80);
		remaining >>>= 7;
	}

	header.push(remaining);

	return Buffer.concat([Buffer.from(header), payload]);
}

/** Seeds a pre-existing user conversation across `conversation_summaries.db` and `jetbox_summaries_proto.pb`. */
export function seedConversationSummary(home: string, conversationId: string, preview: string): string {
	const cliDir = join(home, '.gemini', 'antigravity-cli');
	const dbPath = join(cliDir, 'conversation_summaries.db');
	const now = new Date().toISOString();

	const protoEntry = protoLengthField(
		1,
		Buffer.concat([
			protoLengthField(1, Buffer.from(conversationId, 'utf8')),
			protoLengthField(2, protoLengthField(1, Buffer.from(preview, 'utf8')))
		])
	);

	mkdirSync(cliDir, { recursive: true });

	const db = new Database(dbPath);

	try {
		db.run('PRAGMA busy_timeout = 5000');
		db.run('PRAGMA journal_mode = WAL');
		db.exec(SUMMARIES_SCHEMA_SQL);

		db.transaction(() => {
			db.query(
				'INSERT OR REPLACE INTO conversation_summaries (conversation_id, preview, step_count, last_modified_time, workspace_uris, last_user_input_time) VALUES (?, ?, ?, ?, ?, ?)'
			).run(conversationId, preview, 2, now, '["file:///home/user"]', now);

			db.query(
				'INSERT INTO conversations_fts (conversation_id, title, workspace, project, user_body, agent_body) VALUES (?, ?, ?, ?, ?, ?)'
			).run(conversationId, '', 'user', '', preview, 'ok');

			db.query('INSERT OR REPLACE INTO conversation_parents (conversation_id, parent_id) VALUES (?, ?)').run(
				conversationId,
				''
			);

			appendFileSync(join(cliDir, 'jetbox_summaries_proto.pb'), protoEntry);
		}).immediate();
	} finally {
		db.close();
	}

	return dbPath;
}

/** Counts rows still referencing `conversationId` across `conversation_summaries`, `conversations_fts` and `conversation_parents`. */
export function summaryRowCount(home: string, conversationId: string): number {
	const dbPath = join(home, '.gemini', 'antigravity-cli', 'conversation_summaries.db');

	if (!existsSync(dbPath)) return 0;

	const db = new Database(dbPath, { readonly: true });

	try {
		const queries = [
			'SELECT COUNT(*) AS count FROM conversation_summaries WHERE conversation_id = ?',
			'SELECT COUNT(*) AS count FROM conversations_fts WHERE conversation_id = ?',
			'SELECT COUNT(*) AS count FROM conversation_parents WHERE conversation_id = ?'
		];

		let total = 0;

		for (const sql of queries) {
			total += db.query<{ count: number }, [string]>(sql).get(conversationId)?.count ?? 0;
		}

		return total;
	} finally {
		db.close();
	}
}

/** Reports whether `jetbox_summaries_proto.pb` under `home` still contains `conversationId`. */
export function hasProtoSummary(home: string, conversationId: string): boolean {
	const protoPath = join(home, '.gemini', 'antigravity-cli', 'jetbox_summaries_proto.pb');

	if (!existsSync(protoPath)) return false;

	return readFileSync(protoPath).includes(Buffer.from(conversationId, 'utf8'));
}
