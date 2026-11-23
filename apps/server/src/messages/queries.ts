import type { Conversation, DirectMessage, InboxEvent, MessageAttachment } from '@recoder/shared';
import type { StoredAccount } from '../accounts/account-records';
import { messageableAccount, personSummary } from '../people/summary';
import { rows, type QueryWork } from './database';

type DbNumber = string | number;

type Pair = [string, string];

export interface ConversationRow {
	id: string;
	first_account_id: string;
	second_account_id: string;
	last_sequence: DbNumber;
	created_at: string;
	updated_at: string;
}

interface ConversationViewRow extends ConversationRow {
	other: string;
	mine: DbNumber;
	theirs: DbNumber;
	unread: DbNumber;
	message_id: string | null;
	author_id: string;
	client_id: string;
	body: string;
	attachments: string;
	message_at: string;
}

export interface MessageRow {
	id: string;
	conversation_id: string;
	sequence: DbNumber;
	author_id: string;
	client_id: string;
	body: string;
	attachments: string;
	created_at: string;
}

type Change = Extract<InboxEvent, { type: 'message' | 'read' }>;

export const INBOX_HISTORY = 1000;

export function messageFromRow(row: MessageRow): DirectMessage {
	return {
		id: row.id,
		conversationId: row.conversation_id,
		sequence: Number(row.sequence),
		authorId: row.author_id,
		clientId: row.client_id,
		body: row.body,
		attachments: JSON.parse(row.attachments) as MessageAttachment[],
		createdAt: row.created_at
	};
}

function conversationFromRow(row: ConversationViewRow): Conversation {
	const other = JSON.parse(row.other) as StoredAccount;

	return {
		id: row.id,
		with: personSummary(other),
		open: messageableAccount(other),
		lastMessage: row.message_id
			? messageFromRow({
					id: row.message_id,
					conversation_id: row.id,
					sequence: row.last_sequence,
					author_id: row.author_id,
					client_id: row.client_id,
					body: row.body,
					attachments: row.attachments,
					created_at: row.message_at
				})
			: null,
		lastSequence: Number(row.last_sequence),
		readSequence: Number(row.mine),
		theirReadSequence: Number(row.theirs),
		unread: Number(row.unread),
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export class MessageQueries {
	constructor(private readonly shared: boolean) {}

	*accounts([first, second]: Pair): QueryWork<StoredAccount[]> {
		const values = yield* rows<{ value: string }>(
			`SELECT CAST(value AS TEXT) AS value FROM ${this.records('accounts')}
			WHERE id IN ($1, $2)${this.shared ? " AND collection = 'accounts' ORDER BY id FOR UPDATE" : ''}`,
			first,
			second
		);

		return values.map(({ value }) => JSON.parse(value) as StoredAccount);
	}

	*participant(id: string, accountId: string, lock = false): QueryWork<ConversationRow | undefined> {
		const [row] = yield* rows<ConversationRow>(
			`SELECT * FROM dm_conversations WHERE id = $1 AND (first_account_id = $2 OR second_account_id = $2)
			${this.shared && lock ? 'FOR UPDATE' : ''}`,
			id,
			accountId
		);

		return row;
	}

	*conversations(accountId: string, id: string | null = null): QueryWork<Conversation[]> {
		const result = yield* rows<ConversationViewRow>(
			`SELECT c.*, CAST(a.value AS TEXT) AS other,
				COALESCE(mine.read_sequence, 0) AS mine, COALESCE(theirs.read_sequence, 0) AS theirs,
				m.id AS message_id, m.author_id, m.client_id, m.body, CAST(m.attachments AS TEXT) AS attachments,
				m.created_at AS message_at,
				(SELECT COUNT(*) FROM dm_messages unread WHERE unread.conversation_id = c.id
					AND unread.sequence > COALESCE(mine.read_sequence, 0) AND unread.author_id = a.id) AS unread
			FROM dm_conversations c
			JOIN ${this.records('accounts')} a ON a.id = CASE WHEN c.first_account_id = $1
				THEN c.second_account_id ELSE c.first_account_id END
				${this.shared ? "AND a.collection = 'accounts'" : ''}
			LEFT JOIN dm_reads mine ON mine.conversation_id = c.id AND mine.account_id = $1
			LEFT JOIN dm_reads theirs ON theirs.conversation_id = c.id AND theirs.account_id = a.id
			LEFT JOIN dm_messages m ON m.conversation_id = c.id AND m.sequence = c.last_sequence
			WHERE (c.first_account_id = $1 OR c.second_account_id = $1) AND (CAST($2 AS TEXT) IS NULL OR c.id = $2)
			ORDER BY CASE WHEN c.last_sequence = 0 THEN 1 ELSE 0 END, c.updated_at DESC, c.id ASC`,
			accountId,
			id
		);

		return result.map(conversationFromRow);
	}

	*tracked(repoId: string): QueryWork<boolean> {
		const [match] = yield* rows<{ id: string }>(
			`SELECT id FROM ${this.records('repos')} WHERE id = $1
			${this.shared ? "AND collection = 'repos' FOR SHARE" : ''}`,
			repoId
		);

		return !!match;
	}

	*now(): QueryWork<number> {
		if (!this.shared) return Date.now();

		const [row] = yield* rows<{ ms: number }>('SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS ms');

		return Math.floor(row.ms);
	}

	*append(
		accountId: string,
		event: Omit<Extract<Change, { type: 'message' }>, 'cursor'> | Omit<Extract<Change, { type: 'read' }>, 'cursor'>
	): QueryWork<void> {
		const [row] = yield* rows<{ sequence: DbNumber }>(
			`INSERT INTO dm_inbox_cursors (account_id, sequence) VALUES ($1, 1)
			ON CONFLICT(account_id) DO UPDATE SET sequence = dm_inbox_cursors.sequence + 1 RETURNING sequence`,
			accountId
		);

		const cursor = Number(row.sequence);

		yield* rows(
			`INSERT INTO dm_inbox (account_id, sequence, event) VALUES ($1, $2, ${this.json('$3')})`,
			accountId,
			cursor,
			JSON.stringify({ ...event, cursor })
		);

		if (cursor > INBOX_HISTORY)
			yield* rows('DELETE FROM dm_inbox WHERE account_id = $1 AND sequence <= $2', accountId, cursor - INBOX_HISTORY);
	}

	*cursor(accountId: string): QueryWork<number> {
		const [row] = yield* rows<{ sequence: DbNumber }>(
			'SELECT sequence FROM dm_inbox_cursors WHERE account_id = $1',
			accountId
		);

		return Number(row?.sequence ?? 0);
	}

	*eventsAfter(accountId: string, cursor: number): QueryWork<Change[]> {
		const otherId = this.shared
			? "i.event #>> '{conversation,with,accountId}'"
			: "json_extract(i.event, '$.conversation.with.accountId')";

		const events = yield* rows<{ event: string; other: string | null }>(
			`SELECT CAST(i.event AS TEXT) AS event, CAST(a.value AS TEXT) AS other FROM dm_inbox i
			LEFT JOIN ${this.records('accounts')} a ON a.id = (${otherId})
				${this.shared ? "AND a.collection = 'accounts'" : ''}
			WHERE i.account_id = $1 AND i.sequence > $2 ORDER BY i.sequence LIMIT $3`,
			accountId,
			cursor,
			INBOX_HISTORY
		);

		return events.map(({ event, other }) => {
			const change = JSON.parse(event) as Change;

			change.conversation.open = other !== null && messageableAccount(JSON.parse(other) as StoredAccount);

			return change;
		});
	}

	json(parameter: string): string {
		return this.shared ? `CAST(CAST(${parameter} AS TEXT) AS JSONB)` : parameter;
	}

	private records(table: 'accounts' | 'repos'): string {
		return this.shared ? 'recoder_records' : table;
	}
}
