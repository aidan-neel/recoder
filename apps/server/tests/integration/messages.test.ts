import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
	MESSAGES_PER_MINUTE,
	type Conversation,
	type ConversationPage,
	type DirectMessage,
	type InboxEvent
} from '@recoder/shared';
import { SESSION_COOKIE } from '../../src/accounts/sessions';
import { PostgresStore } from '../../src/storage/postgres';
import { readEventsUntil } from '../helpers/event-stream';
import { testAccount } from '../helpers/test-account';
import { HaProcesses, type Replica } from './ha-processes';

const url = process.env.RECODER_POSTGRES_TEST_URL;
const base = '/api/messages';
const mira = 'member:github::2';
const sam = 'member:github::3';

function send(replica: Replica, path: string, cookie: string, data: unknown): Promise<Response> {
	return replica.request(path, { method: 'POST', headers: { cookie }, body: JSON.stringify(data) });
}

async function open(replica: Replica, cookie: string, accountId = mira): Promise<Conversation> {
	const response = await send(replica, base, cookie, { accountId });

	expect(response.status).toBe(200);

	return response.json();
}

function message() {
	return { clientId: crypto.randomUUID(), body: 'A message across replicas', attachments: [] };
}

describe.skipIf(!url)('direct messages across PostgreSQL replicas', () => {
	const processes = new HaProcesses(url ?? 'postgres://unused.invalid/disabled');
	let first: Replica;
	let second: Replica;
	let ownerCookie: string;
	let memberCookie: string;

	beforeAll(async () => {
		await processes.initialize();
		[first, second] = await Promise.all([processes.start('replica-a'), processes.start('replica-b')]);

		const store = new PostgresStore(processes.database, async () => {});

		for (const account of [
			testAccount('owner', 'cameron', '1'),
			testAccount(mira, 'mira', '2'),
			testAccount(sam, 'sam', '3')
		]) {
			await store.collection('accounts').set(account);

			const token = randomBytes(32).toString('base64url');
			const now = Date.now();

			const session = {
				id: createHash('sha256').update(token).digest('hex'),
				accountId: account.id,
				createdAt: now,
				expiresAt: now + 60_000,
				lastRefreshedAt: now
			};

			await store.collection<typeof session>('sessions').set(session);

			if (account.id === 'owner') ownerCookie = `${SESSION_COOKIE}=${token}`;
			if (account.id === mira) memberCookie = `${SESSION_COOKIE}=${token}`;
		}
	}, 20_000);

	beforeEach(async () => {
		await processes.database`TRUNCATE dm_inbox, dm_inbox_cursors, dm_reads, dm_messages, dm_conversations`;
	});

	afterAll(() => processes.close());

	test('concurrent sends through two stores commit one consecutive sequence and one result per client ID', async () => {
		const [one, two] = await Promise.all([open(first, ownerCookie), open(second, memberCookie, 'owner')]);

		expect(two.id).toBe(one.id);

		const path = `${base}/${one.id}`;
		const duplicate = message();

		const responses = await Promise.all([
			send(first, path, ownerCookie, duplicate),
			send(second, path, ownerCookie, duplicate),
			...Array.from({ length: 12 }, (_, index) => send(index % 2 ? first : second, path, memberCookie, message()))
		]);

		expect(responses.map(({ status }) => status)).toEqual(Array.from({ length: 14 }, () => 200));

		const [stored, replayed] = (await Promise.all(
			responses.slice(0, 2).map((response) => response.json())
		)) as DirectMessage[];

		const page = (await second.json(path, { headers: { cookie: ownerCookie } })) as ConversationPage;

		expect(replayed).toEqual(stored);
		expect(page.messages.map(({ sequence }) => sequence)).toEqual(Array.from({ length: 13 }, (_, index) => index + 1));
	});

	test('a client following one API replica receives a message sent to the other', async () => {
		const { id } = await open(first, ownerCookie);

		const response = await second.request(`${base}/events`, {
			headers: { cookie: memberCookie },
			signal: AbortSignal.timeout(5_000)
		});

		expect(response.status).toBe(200);

		const stream = readEventsUntil<InboxEvent, InboxEvent>(
			response.body!,
			(event) => (event.type === 'message' ? event : undefined),
			'the remote replica to poll the message'
		);

		const sent = await send(first, `${base}/${id}`, ownerCookie, message());

		expect(sent.status).toBe(200);

		expect(await stream).toMatchObject({
			type: 'message',
			cursor: 1,
			message: await sent.json(),
			conversation: { unread: 1 }
		});
	});

	test('racing sends in different conversations and replicas share one account rate limit', async () => {
		const [one, two] = await Promise.all([open(first, ownerCookie), open(second, ownerCookie, sam)]);

		const results = await Promise.all(
			Array.from({ length: MESSAGES_PER_MINUTE + 1 }, (_, index) =>
				index % 2
					? send(first, `${base}/${one.id}`, ownerCookie, message())
					: send(second, `${base}/${two.id}`, ownerCookie, message())
			)
		);

		expect(results.filter(({ status }) => status === 200)).toHaveLength(MESSAGES_PER_MINUTE);
		expect(results.filter(({ status }) => status === 429)).toHaveLength(1);
	});
});
