import {
	MESSAGE_PAGE,
	MESSAGES_PER_MINUTE,
	type Conversation,
	type ConversationList,
	type ConversationPage,
	type DirectMessage,
	type InboxEvent
} from '@recoder/shared';
import { afterEach, expect, test } from 'bun:test';
import { accounts } from '../../src/accounts/account-records';
import { serverAccessToken } from '../../src/accounts/local-access-token';
import { removeMember } from '../../src/accounts/members';
import { createSession, endSession, SESSION_COOKIE } from '../../src/accounts/sessions';
import { EVENT_HEARTBEAT_MS } from '../../src/routes/reviews/event-payload';
import { collection } from '../../src/storage/backend';
import { sqlite } from '../../src/storage/sqlite';
import { readEventsUntil } from '../helpers/event-stream';
import { settleOnClock, useFakeClock } from '../helpers/fake-clock';
import { localApp, requestFrom, sendAs } from '../helpers/local-app';
import { testAccount } from '../helpers/test-account';

useFakeClock();

const base = '/api/messages';
const mira = 'member:github::12';
const sam = 'member:github::13';

afterEach(async () => {
	sqlite().exec(
		'DELETE FROM dm_inbox; DELETE FROM dm_inbox_cursors; DELETE FROM dm_reads; DELETE FROM dm_messages; DELETE FROM dm_conversations'
	);

	await Promise.all([collection('accounts').clear(), collection('sessions').clear()]);
});

async function claim() {
	const users = [testAccount('owner', 'mina'), testAccount(mira, 'mira'), testAccount(sam, 'sam')];

	const [owner, member, bystander] = await Promise.all(
		users.map(async (account) => {
			await accounts.update(account.id, () => account);

			return `${SESSION_COOKIE}=${(await createSession(account.id)).token}`;
		})
	);

	return { owner, member, bystander };
}

async function open(first: string, secondId: string) {
	const response = await sendAs(base, 'POST', first, { accountId: secondId });

	expect(response.status).toBe(200);

	return (await response.json()) as Conversation;
}

function send(path: string, cookie: string, clientId: string = crypto.randomUUID(), body = 'Hello Mira') {
	return sendAs(path, 'POST', cookie, { body, clientId, attachments: [] });
}

function connect(cookie: string, cursor?: number, signal?: AbortSignal) {
	return localApp.request(`${base}/events`, {
		headers: { cookie, ...(cursor !== undefined && { 'Last-Event-ID': String(cursor) }) },
		signal
	});
}

async function frame(response: Response) {
	expect(response.status).toBe(200);
	expect(response.headers.get('Content-Type')).toContain('text/event-stream');

	const reader = response.body!.getReader();

	try {
		const { value } = await reader.read();
		const chunk = new TextDecoder().decode(value);
		const lines = chunk.trimEnd().split('\n');
		const event = JSON.parse(lines.find((line) => line.startsWith('data: '))!.slice(6)) as InboxEvent;
		const id = lines.find((line) => line.startsWith('id: '))?.slice(4);

		return { event, id };
	} finally {
		await reader.cancel();
	}
}

test('people and message routes stay locked before the server is claimed', async () => {
	for (const path of ['/api/people', '/api/people/github/octocat', base, `${base}/events`]) {
		const response = await requestFrom('192.0.2.10', path);

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ kind: 'setup-locked' });
	}

	expect((await localApp.request(base)).status).toBe(403);
});

test('the machine token grants no messaging access, even to the admin inbox', async () => {
	await claim();

	const headers = { authorization: `Bearer ${serverAccessToken()}` };

	const routes = [
		['GET', base],
		['POST', base],
		['GET', `${base}/events`],
		['GET', `${base}/id`],
		['POST', `${base}/id`],
		['POST', `${base}/id/read`]
	];

	for (const [method, path] of routes) expect((await localApp.request(path, { method, headers })).status).toBe(403);
});

test('a conversation is invisible to non-participants, including the admin', async () => {
	const { owner, member } = await claim();
	const conversation = await open(member, sam);
	const path = `${base}/${conversation.id}`;
	const list = (await (await sendAs(base, 'GET', owner)).json()) as ConversationList;

	const attempts = [
		await sendAs(path, 'GET', owner),
		await sendAs(`${path}?before=wrong`, 'GET', owner),
		await sendAs(path, 'POST', owner, {}),
		await sendAs(`${path}/read`, 'POST', owner, { through: -1 })
	];

	expect(list.conversations).toEqual([]);
	expect(attempts.map(({ status }) => status)).toEqual([404, 404, 404, 404]);
});

test('two concurrent starts and sends share one conversation and allocate consecutive sequences', async () => {
	const { owner, member } = await claim();
	const [mine, theirs] = await Promise.all([open(owner, mira), open(member, 'owner')]);
	const path = `${base}/${mine.id}`;

	expect(theirs.id).toBe(mine.id);

	const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => send(path, index % 2 ? member : owner)));
	const page = (await (await sendAs(path, 'GET', owner)).json()) as ConversationPage;

	expect(responses.every(({ status }) => status === 200)).toBe(true);
	expect(page.messages.map(({ sequence }) => sequence)).toEqual(Array.from({ length: 12 }, (_, n) => n + 1));
	expect(page.conversation).toMatchObject({ lastSequence: 12, unread: 6, readSequence: 0 });
});

test('a repeated client message returns the original without another inbox event', async () => {
	const { owner, member } = await claim();
	const conversation = await open(owner, mira);
	const path = `${base}/${conversation.id}`;

	const first = await send(path, owner, 'same', '  Original message  ');
	const message = (await first.json()) as DirectMessage;
	const retry = await send(path, owner, 'same', 'This is only a retry');
	const snapshot = await frame(await connect(member));

	expect(message.body).toBe('Original message');
	expect(await retry.json()).toEqual(message);
	expect(snapshot.event).toMatchObject({ type: 'snapshot', cursor: 1, conversations: [{ lastSequence: 1 }] });
});

test('sending faster than the per-account rate limit returns 429', async () => {
	const { owner, member } = await claim();
	const first = await open(owner, mira);
	const second = await open(owner, sam);

	const responses = await Promise.all(
		Array.from({ length: MESSAGES_PER_MINUTE + 1 }, (_, index) =>
			send(`${base}/${(index % 2 ? first : second).id}`, owner)
		)
	);

	expect(responses.filter(({ status }) => status === 200)).toHaveLength(MESSAGES_PER_MINUTE);
	expect(responses.filter(({ status }) => status === 429)).toHaveLength(1);
	expect((await send(`${base}/${first.id}`, member)).status).toBe(200);
});

test('pages do not skip or duplicate messages around the older cursor', async () => {
	const { owner, member } = await claim();
	const { id } = await open(owner, mira);
	const path = `${base}/${id}`;

	for (let i = 0; i < MESSAGE_PAGE + 2; i++) {
		expect((await send(path, i % 2 ? owner : member)).status).toBe(200);
	}

	const latest = (await (await sendAs(path, 'GET', owner)).json()) as ConversationPage;
	const earlier = (await (await sendAs(`${path}?before=${latest.before}`, 'GET', owner)).json()) as ConversationPage;

	expect(latest.messages).toHaveLength(MESSAGE_PAGE);
	expect(latest.messages[0].sequence).toBe(3);
	expect(earlier.messages.map(({ sequence }) => sequence)).toEqual([1, 2]);
	expect(earlier.before).toBeNull();
});

test('an attachment cannot reference a repository the server does not track', async () => {
	const { owner } = await claim();
	const { id } = await open(owner, mira);

	const response = await sendAs(`${base}/${id}`, 'POST', owner, {
		clientId: 'attachment',
		body: 'Refer to this pull',
		attachments: [{ kind: 'pull', repoId: 'untracked', number: 1 }]
	});

	expect(response.status).toBe(400);
});

test('a removed member leaves a readable conversation which cannot take replies', async () => {
	const { owner, member } = await claim();
	const { id } = await open(owner, mira);
	const path = `${base}/${id}`;

	expect((await send(path, owner)).status).toBe(200);
	await removeMember(mira);

	const page = (await (await sendAs(path, 'GET', owner)).json()) as ConversationPage;

	expect(page.conversation).toMatchObject({ open: false, with: { accountId: mira } });
	expect(page.messages).toHaveLength(1);
	expect((await send(path, owner)).status).toBe(409);
	expect((await sendAs(base, 'POST', owner, { accountId: mira })).status).toBe(409);
	expect((await sendAs(path, 'GET', member)).status).toBe(401);

	expect((await frame(await connect(owner, 0))).event).toMatchObject({
		type: 'message',
		conversation: { open: false }
	});
});

test('a read mark is clamped and cannot regress, and its event reaches the other participant', async () => {
	const { owner, member } = await claim();
	const { id } = await open(owner, mira);
	const path = `${base}/${id}`;

	await send(path, owner);
	await send(path, owner);
	await sendAs(`${path}/read`, 'POST', member, { through: 99 });

	const backwards = await sendAs(`${path}/read`, 'POST', member, { through: 1 });
	const resumed = await frame(await connect(owner, 2));

	expect(await backwards.json()).toMatchObject({ readSequence: 2, unread: 0 });
	expect(resumed.event).toMatchObject({ type: 'read', cursor: 3, conversation: { theirReadSequence: 2 } });
	expect((await frame(await connect(owner))).event).toMatchObject({ cursor: 3 });
});

test('a reconnect resumes after the SSE event ID and snapshots again after that ID is trimmed', async () => {
	const { owner, member } = await claim();
	const { id } = await open(owner, mira);
	const path = `${base}/${id}`;

	expect(await frame(await connect(member))).toMatchObject({ id: '0', event: { type: 'snapshot', cursor: 0 } });
	await send(path, owner);
	expect(await frame(await connect(member, 0))).toMatchObject({ id: '1', event: { type: 'message', cursor: 1 } });

	sqlite().query('UPDATE dm_inbox_cursors SET sequence = 1000 WHERE account_id = ?').run(mira);
	await send(path, owner);

	expect(sqlite().query('SELECT 1 FROM dm_inbox WHERE account_id = ? AND sequence = 1').get(mira)).toBeNull();

	expect(await frame(await connect(member, 1))).toMatchObject({
		id: '1001',
		event: { type: 'snapshot', cursor: 1001, conversations: [{ lastSequence: 2, unread: 2 }] }
	});
});

test('a connected SQLite stream wakes on a new message', async () => {
	const { owner, member } = await claim();
	const { id } = await open(owner, mira);
	const response = await connect(member, 0);

	const received = readEventsUntil<InboxEvent, DirectMessage>(
		response.body!,
		(event) => (event.type === 'message' ? event.message : undefined),
		'the live message'
	);

	await send(`${base}/${id}`, owner);
	expect((await settleOnClock(received, 5, 50)).body).toBe('Hello Mira');
});

test('aborting the request closes an idle inbox stream', async () => {
	const { member } = await claim();
	const controller = new AbortController();
	const response = await connect(member, 0, controller.signal);
	const reader = response.body!.getReader();

	try {
		const event = reader.read();

		controller.abort();
		expect((await settleOnClock(event, 5, 50)).done).toBe(true);
	} finally {
		await reader.cancel();
	}
});

test('a heartbeat has no event ID', async () => {
	const { member } = await claim();
	const heartbeat = frame(await connect(member, 0));

	expect(await settleOnClock(heartbeat, EVENT_HEARTBEAT_MS, 2 * EVENT_HEARTBEAT_MS)).toEqual({
		id: undefined,
		event: { type: 'heartbeat', at: expect.any(String) }
	});
});

test('a signed-out session cannot keep reading inbox events', async () => {
	const { owner, member } = await claim();
	const { id } = await open(owner, mira);
	const response = await connect(member, 0);
	const reader = response.body!.getReader();
	const event = reader.read();

	try {
		await endSession(member.slice(SESSION_COOKIE.length + 1));
		await send(`${base}/${id}`, owner);

		expect((await settleOnClock(event, 5, 50)).done).toBe(true);
	} finally {
		await reader.cancel();
	}
});
