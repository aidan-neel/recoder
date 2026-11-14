import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Repo, RepoChat, RepoChatEvent, RepoChatMessage } from '@recoder/shared';
import { INTERRUPTED } from '../../src/repo-chat/chat-record';
import { readEventsUntil } from '../helpers/event-stream';
import { localForgeFixture, type LocalForgeFixture } from '../helpers/local-forge';
import { runCorrectnessProcess } from './ha-correctness-process';
import { HaProcesses, type Replica } from './ha-processes';

const testUrl = process.env.RECODER_POSTGRES_TEST_URL;

/** A message with this word gets a reply that streams a little, then hangs until its request is aborted. */
const HANG = 'HANG';

describe.skipIf(!testUrl)('repository chat across replicas (requires RECODER_POSTGRES_TEST_URL)', () => {
	const model = modelStub();
	const processes = new HaProcesses(testUrl ?? 'postgres://unused.invalid/disabled');
	let fixture: LocalForgeFixture | undefined;
	let writer: Replica;
	let reader: Replica;
	let chat: RepoChat;

	beforeAll(async () => {
		await processes.initialize();
		writer = await processes.start('replica-a');
		fixture = await localForgeFixture();

		const repo = (await writer.json('/api/repos', {
			method: 'POST',
			body: JSON.stringify({ name: 'fixture', url: fixture.repo.url, provider: 'local', defaultBranch: 'main' })
		})) as Repo;

		await writer.json('/api/settings/models', {
			method: 'PUT',
			body: JSON.stringify({
				baseUrl: `http://127.0.0.1:${model.port}/v1`,
				apiKey: 'test',
				models: [{ id: 'chat-model', label: 'chat', model: 'chat-model' }],
				orchestratorModelId: 'chat-model',
				specialistModelId: 'chat-model'
			})
		});

		reader = await processes.start('replica-b');

		chat = (await writer.json('/api/chats', {
			method: 'POST',
			body: JSON.stringify({ repoId: repo.id, text: 'Please review #7' })
		})) as RepoChat;
	}, 30_000);

	afterAll(async () => {
		await model.stop(true);
		await processes.close();

		if (fixture) await rm(fileURLToPath(fixture.repo.url), { recursive: true, force: true });
	});

	test('a reply written after its request returned still reads settings, so asking for a review starts one', async () => {
		const reply = await followUntil(
			reader,
			chat.id,
			(message) => message.id === chat.messages[1].id && isClosed(message)
		);

		expect(reply).toMatchObject({ status: 'done', text: 'Started a review of #7.', review: { prNumber: 7 } });
	}, 20_000);

	test('another replica follows a reply as it streams, and its stop reaches only that reply', async () => {
		await send(writer, chat.id, `${HANG} Walk me through the checkout flow.`);

		const open = await followUntil(reader, chat.id, (message) => message.text === 'Partial answer');

		expect(await stop(reader, chat.id, chat.messages[1].id)).toEqual({ stopped: false });
		expect(await stop(reader, chat.id, open.id)).toEqual({ stopped: true });

		expect(await followUntil(reader, chat.id, (message) => message.id === open.id && isClosed(message))).toMatchObject({
			status: 'done',
			stopped: true,
			text: 'Partial answer'
		});
	}, 20_000);

	test('a replica shutting down closes its open reply as interrupted instead of leaving it for 30 seconds', async () => {
		await send(writer, chat.id, `${HANG} And the refunds?`);

		const open = await followUntil(
			reader,
			chat.id,
			(message) => message.text === 'Partial answer' && !isClosed(message)
		);

		writer.terminate();

		expect(
			await followUntil(reader, chat.id, (message) => message.id === open.id && isClosed(message), 10_000)
		).toMatchObject({ status: 'error', text: 'Partial answer', failure: { reason: INTERRUPTED } });
	}, 20_000);
});

test.skipIf(!testUrl)(
	'a replica whose clock runs ahead judges a reply writer by the database clock and leaves it open',
	async () => {
		if (!testUrl) return;

		const output = await runCorrectnessProcess(
			testUrl,
			`
import assert from 'node:assert/strict';
import {initializeStorage} from './apps/server/src/storage/backend.ts';
import {closeStore} from './apps/server/src/store.ts';
import {newChat,newTurn} from './apps/server/src/repo-chat/chat-record.ts';
import {loadChat,openChat,saveReply} from './apps/server/src/repo-chat/chat-turns.ts';
await initializeStorage();
try {
 const at=new Date().toISOString();
 const turn=newTurn('How is the total computed?','chat-model',at);
 const chat=await openChat(newChat('repo','Totals',at,'owner'),turn);
 assert.equal(await saveReply(chat.id,{...turn.reply,text:'It sums'}),'saved');
 const realNow=Date.now;
 Date.now=()=>realNow()+120_000;
 const loaded=await loadChat(chat.id);
 Date.now=realNow;
 assert.equal(loaded.messages.at(-1).status,'streaming','A replica whose clock runs ahead closed a live reply.');
 console.log('writer judged by the database clock');
} finally {await closeStore();}
`
		);

		expect(output).toContain('writer judged by the database clock');
	},
	15_000
);

/** A model that answers every chat at once, or streams a little and hangs when the prompt holds `HANG`. */
function modelStub() {
	const encoder = new TextEncoder();

	const chunk = (text: string) =>
		encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);

	return Bun.serve({
		port: 0,
		hostname: '127.0.0.1',
		idleTimeout: 0,
		async fetch(request) {
			if (request.method === 'GET') return Response.json({ data: [{ id: 'chat-model' }] });

			const hang = (await request.text()).includes(HANG);

			return new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(chunk(hang ? 'Partial answer' : 'Shared reply.'));

						if (hang) return;

						controller.enqueue(encoder.encode('data: [DONE]\n\n'));
						controller.close();
					}
				}),
				{ headers: { 'content-type': 'text/event-stream' } }
			);
		}
	});
}

async function send(replica: Replica, chatId: string, text: string): Promise<void> {
	await replica.json(`/api/chats/${chatId}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
}

function stop(replica: Replica, chatId: string, messageId: string): Promise<unknown> {
	return replica.json(`/api/chats/${chatId}/stop`, { method: 'POST', body: JSON.stringify({ messageId }) });
}

function isClosed(message: RepoChatMessage): boolean {
	return message.status !== 'streaming';
}

/** Follows the chat's events on `replica` until a message matches `found`, and returns that message. */
async function followUntil(
	replica: Replica,
	chatId: string,
	found: (message: RepoChatMessage) => boolean,
	timeoutMs = 15_000
): Promise<RepoChatMessage> {
	const response = await replica.request(`/api/chats/${chatId}/events`, { signal: AbortSignal.timeout(timeoutMs) });

	if (!response.body) throw new Error(`The chat ${chatId} sent no event stream.`);

	return readEventsUntil<RepoChatEvent, RepoChatMessage>(
		response.body,
		(event) => eventMessages(event).find(found),
		`the chat ${chatId} showed the message it waited for`
	);
}

function eventMessages(event: RepoChatEvent): RepoChatMessage[] {
	if (event.type === 'snapshot') return event.chat.messages;
	if (event.type === 'message') return [event.message];

	return [];
}
