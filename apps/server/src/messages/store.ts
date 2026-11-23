import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
	MESSAGE_MAX_LENGTH,
	MESSAGE_PAGE,
	MESSAGES_PER_MINUTE,
	type Conversation,
	type ConversationList,
	type ConversationPage,
	type DirectMessage,
	type InboxEvent
} from '@recoder/shared';
import { z } from 'zod';
import { messageableAccount } from '../people/summary';
import { rows, runMessageQueries, type MessageDatabase, type QueryWork } from './database';
import { INBOX_HISTORY, MessageQueries, messageFromRow, type ConversationRow, type MessageRow } from './queries';

export class MessageError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 404 | 409 | 429
	) {
		super(message);
		this.name = 'MessageError';
	}
}

function notFound(): MessageError {
	return new MessageError('Conversation not found.', 404);
}

type InboxData = Exclude<InboxEvent, { type: 'heartbeat' }>;

const conversationId = /^[a-f0-9]{64}$/;
const validText = (value: string) => !value.includes('\0') && !/[\uD800-\uDFFF]/u.test(value);
const accountKey = z.string().min(1).max(512).refine(validText);
const startSchema = z.object({ accountId: accountKey });

const sendSchema = z.object({
	clientId: z.string().min(1).max(200).refine(validText),
	body: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH).refine(validText),
	attachments: z.array(z.object({ kind: z.literal('pull'), repoId: accountKey, number: z.int().positive() })).max(5)
});

const readSchema = z.object({ through: z.int().nonnegative() });

export function parseSequence(value: string | undefined): number | null {
	if (value === undefined || !/^\d+$/.test(value)) return null;

	const sequence = Number(value);

	return Number.isSafeInteger(sequence) ? sequence : null;
}

export class MessageStore {
	readonly shared: boolean;
	private readonly query: MessageQueries;
	private readonly listeners = new EventEmitter().setMaxListeners(0);

	constructor(private readonly database: MessageDatabase) {
		this.shared = database.kind === 'postgres';
		this.query = new MessageQueries(this.shared);
	}

	async list(accountId: string): Promise<ConversationList> {
		return { conversations: await this.read(this.query.conversations(accountId)) };
	}

	async start(accountId: string, input: unknown): Promise<Conversation> {
		const parsed = startSchema.safeParse(input);

		if (!parsed.success) throw new MessageError('Specify an account to message.', 400);

		return this.write(this.startConversation(accountId, parsed.data.accountId));
	}

	page(accountId: string, id: string, before?: string): Promise<ConversationPage> {
		return this.read(this.conversationPage(accountId, id, before));
	}

	async send(accountId: string, id: string, input: unknown): Promise<DirectMessage> {
		const { message, notify } = await this.write(this.sendMessage(accountId, id, input));

		if (notify) this.notify(notify);

		return message;
	}

	async markRead(accountId: string, id: string, input: unknown): Promise<Conversation> {
		const { conversation, notify } = await this.write(this.readThrough(accountId, id, input));

		if (notify) this.notify(notify);

		return conversation;
	}

	inbox(accountId: string, cursor: number | null): Promise<InboxData[]> {
		return this.read(this.inboxData(accountId, cursor));
	}

	subscribe(accountId: string, wake: () => void): () => void {
		this.listeners.on(accountId, wake);

		return () => this.listeners.off(accountId, wake);
	}

	private read<T>(work: QueryWork<T>): Promise<T> {
		return runMessageQueries(this.database, false, work);
	}

	private write<T>(work: QueryWork<T>): Promise<T> {
		return runMessageQueries(this.database, true, work);
	}

	private notify(row: ConversationRow): void {
		if (this.shared) return;

		this.listeners.emit(row.first_account_id);
		this.listeners.emit(row.second_account_id);
	}

	private *startConversation(accountId: string, otherId: string): QueryWork<Conversation> {
		if (accountId === otherId) throw new MessageError('This account cannot be messaged.', 409);

		const [first, second] = [accountId, otherId].sort();
		const people = yield* this.query.accounts([first, second]);

		if (people.length !== 2 || !people.every(messageableAccount))
			throw new MessageError('This account cannot be messaged.', 409);

		const id = createHash('sha256')
			.update(JSON.stringify([first, second]))
			.digest('hex');

		const now = new Date(yield* this.query.now()).toISOString();

		yield* rows(
			`INSERT INTO dm_conversations (id, first_account_id, second_account_id, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $4) ON CONFLICT(id) DO NOTHING`,
			id,
			first,
			second,
			now
		);

		return yield* this.view(accountId, id);
	}

	private *view(accountId: string, id: string): QueryWork<Conversation> {
		if (!conversationId.test(id)) throw notFound();

		const [conversation] = yield* this.query.conversations(accountId, id);

		if (!conversation) throw notFound();

		return conversation;
	}

	private *conversationPage(accountId: string, id: string, beforeParam?: string): QueryWork<ConversationPage> {
		const conversation = yield* this.view(accountId, id);
		const before = parseSequence(beforeParam);

		if (beforeParam !== undefined && !before) throw new MessageError('Specify a positive message sequence.', 400);

		const page = yield* rows<MessageRow>(
			`SELECT id, conversation_id, sequence, author_id, client_id, body,
				CAST(attachments AS TEXT) AS attachments, created_at
			FROM dm_messages WHERE conversation_id = $1 AND sequence <= $2 ORDER BY sequence DESC LIMIT $3`,
			id,
			before === null ? conversation.lastSequence : before - 1,
			MESSAGE_PAGE + 1
		);

		const messages = page.slice(0, MESSAGE_PAGE).reverse().map(messageFromRow);

		return { conversation, messages, before: page.length > MESSAGE_PAGE ? messages[0].sequence : null };
	}

	/** Account rows are always locked before the conversation, in database order. This serializes sends by one
	 * author across conversations and also orders inbox writes and concurrent membership removal. */
	private *lockConversation(accountId: string, id: string) {
		if (!conversationId.test(id)) throw notFound();

		const pair = yield* this.query.participant(id, accountId);

		if (!pair) throw notFound();

		const people = yield* this.query.accounts([pair.first_account_id, pair.second_account_id]);

		if (!messageableAccount(people.find((person) => person.id === accountId))) throw notFound();

		const conversation = yield* this.query.participant(id, accountId, true);

		if (!conversation) throw notFound();

		return {
			conversation,
			otherActive: messageableAccount(people.find((person) => person.id !== accountId))
		};
	}

	private *sendMessage(
		accountId: string,
		id: string,
		raw: unknown
	): QueryWork<{ message: DirectMessage; notify?: ConversationRow }> {
		const { conversation, otherActive } = yield* this.lockConversation(accountId, id);

		if (!otherActive) throw new MessageError('This conversation is closed.', 409);

		const parsed = sendSchema.safeParse(raw);

		if (!parsed.success) throw new MessageError('Specify a message and valid attachments.', 400);

		const input = parsed.data;

		const [existing] = yield* rows<MessageRow>(
			`SELECT id, conversation_id, sequence, author_id, client_id, body,
				CAST(attachments AS TEXT) AS attachments, created_at
			FROM dm_messages WHERE author_id = $1 AND client_id = $2`,
			accountId,
			input.clientId
		);

		if (existing) return { message: messageFromRow(existing) };

		for (const repoId of new Set(input.attachments.map((attachment) => attachment.repoId))) {
			if (!(yield* this.query.tracked(repoId)))
				throw new MessageError('The attachment repository is not tracked.', 400);
		}

		const now = yield* this.query.now();

		const [recent] = yield* rows<{ count: string | number }>(
			'SELECT COUNT(*) AS count FROM dm_messages WHERE author_id = $1 AND created_at > $2',
			accountId,
			new Date(now - 60_000).toISOString()
		);

		if (Number(recent.count) >= MESSAGES_PER_MINUTE)
			throw new MessageError('Too many messages. Try again in a minute.', 429);

		const message: DirectMessage = {
			id: randomUUID(),
			conversationId: id,
			sequence: Number(conversation.last_sequence) + 1,
			authorId: accountId,
			clientId: input.clientId,
			body: input.body,
			attachments: input.attachments,
			createdAt: new Date(now).toISOString()
		};

		yield* rows(
			`INSERT INTO dm_messages (conversation_id, sequence, id, author_id, client_id, body, attachments, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, ${this.query.json('$7')}, $8)`,
			id,
			message.sequence,
			message.id,
			accountId,
			message.clientId,
			message.body,
			JSON.stringify(message.attachments),
			message.createdAt
		);

		yield* rows(
			'UPDATE dm_conversations SET last_sequence = $1, updated_at = $2 WHERE id = $3',
			message.sequence,
			message.createdAt,
			id
		);

		for (const participant of [conversation.first_account_id, conversation.second_account_id]) {
			yield* this.query.append(participant, {
				type: 'message',
				conversation: yield* this.view(participant, id),
				message
			});
		}

		return { message, notify: conversation };
	}

	private *readThrough(
		accountId: string,
		id: string,
		raw: unknown
	): QueryWork<{ conversation: Conversation; notify?: ConversationRow }> {
		const { conversation } = yield* this.lockConversation(accountId, id);
		const parsed = readSchema.safeParse(raw);

		if (!parsed.success) throw new MessageError('Specify a nonnegative read sequence.', 400);

		const sequence = Math.min(parsed.data.through, Number(conversation.last_sequence));

		if (sequence === 0) return { conversation: yield* this.view(accountId, id) };

		const [changed] = yield* rows<{ read_sequence: number }>(
			`INSERT INTO dm_reads (conversation_id, account_id, read_sequence) VALUES ($1, $2, $3)
			ON CONFLICT(conversation_id, account_id) DO UPDATE SET read_sequence = excluded.read_sequence
			WHERE dm_reads.read_sequence < excluded.read_sequence RETURNING read_sequence`,
			id,
			accountId,
			sequence
		);

		const updated = yield* this.view(accountId, id);

		if (!changed) return { conversation: updated };

		const other = updated.with.accountId;

		yield* this.query.append(accountId, { type: 'read', conversation: updated });
		yield* this.query.append(other, { type: 'read', conversation: yield* this.view(other, id) });

		return { conversation: updated, notify: conversation };
	}

	private *inboxData(accountId: string, cursor: number | null): QueryWork<InboxData[]> {
		const current = yield* this.query.cursor(accountId);

		if (cursor !== null && cursor <= current && (current <= INBOX_HISTORY || cursor > current - INBOX_HISTORY)) {
			return cursor === current ? [] : yield* this.query.eventsAfter(accountId, cursor);
		}

		return [{ type: 'snapshot', cursor: current, conversations: yield* this.query.conversations(accountId) }];
	}
}
