import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { pathToFileURL } from 'node:url';
import {
	MAX_CHAT_MESSAGE_CHARS,
	type Repo,
	type RepoChat,
	type RepoChatEvent,
	type RepoChatMessage
} from '@recoder/shared';
import { app } from '../../src/app';
import { imageDataUrl } from '../../src/models/llm/message-images';
import { replySettled } from '../../src/repo-chat/chat-reply';
import { requestStop, subscribeRepoChat } from '../../src/repo-chat/chat-turns';
import { getStoredSettings, setReviewOverrides } from '../../src/review/session/review-settings';
import { db, reviewMetrics } from '../../src/store';
import { readEventsUntil } from '../helpers/event-stream';
import { useCommittedRepos } from '../helpers/git';
import { imageUpload } from '../helpers/images';

const originalFetch = globalThis.fetch;
const originalSettings = getStoredSettings();
const committedRepo = useCommittedRepos('recoder-chat-repo-');
const MODEL_URL = 'http://model.test/v1';

beforeEach(() => {
	setReviewOverrides({
		baseUrl: MODEL_URL,
		apiKey: 'test',
		models: [{ id: 'lead', label: 'Lead', model: 'lead' }],
		orchestratorModelId: 'lead'
	});
});

afterEach(async () => {
	mock.restore();
	globalThis.fetch = originalFetch;
	setReviewOverrides(originalSettings);
	await db.repoChats.clear();
	await db.repos.clear();
});

async function trackedRepo(files: Record<string, string> = { 'README.md': '# Shop\n' }): Promise<Repo> {
	const root = await committedRepo(files);
	const at = new Date().toISOString();

	return db.repos.set({
		id: crypto.randomUUID(),
		name: 'acme/shop',
		url: pathToFileURL(root).href,
		provider: 'local',
		defaultBranch: 'main',
		createdAt: at,
		updatedAt: at
	});
}

function post(path: string, body: unknown): Promise<Response> {
	return Promise.resolve(
		app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
	);
}

async function startChat(repoId: string, text: string): Promise<RepoChat> {
	const response = await post('/api/chats', { repoId, text });

	expect(response.status).toBe(201);

	return (await response.json()) as RepoChat;
}

/**
 * A model that streams `chunks`, then hangs until its request is aborted when
 * `hang` is set. It keeps each request's body and abort signal.
 */
function streamingModel(chunks: string[], hang = false): { bodies: string[]; signals: (AbortSignal | undefined)[] } {
	const bodies: string[] = [];
	const signals: (AbortSignal | undefined)[] = [];

	globalThis.fetch = (async (_url, init) => {
		bodies.push(init?.body as string);
		signals.push(init?.signal ?? undefined);

		return new Response(
			new ReadableStream({
				start(controller) {
					for (const chunk of chunks)
						controller.enqueue(
							new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`)
						);

					if (!hang) {
						controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
						controller.close();

						return;
					}

					init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
				}
			}),
			{ headers: { 'content-type': 'text/event-stream' } }
		);
	}) as typeof fetch;

	return { bodies, signals };
}

/** Resolves once the chat's open reply holds `text`. */
async function replyHolds(chatId: string, text: string): Promise<void> {
	const holds = async () => (await db.repoChats.get(chatId))?.messages.at(-1)?.text === text;

	if (await holds()) return;

	await new Promise<void>((resolve) => {
		const off = subscribeRepoChat(chatId, () => {
			void holds().then((done) => {
				if (!done) return;

				off();
				resolve();
			});
		});
	});
}

/**
 * The events of the chat's stream until they show its reply closed, as the
 * page would read them, and that reply. The reply may close before the
 * stream opens, so the snapshot can already hold it closed.
 */
async function eventsUntilReplyCloses(chatId: string): Promise<{ events: RepoChatEvent[]; reply: RepoChatMessage }> {
	const response = await app.request(`/api/chats/${chatId}/events`);
	const events: RepoChatEvent[] = [];

	if (!response.body) throw new Error(`The chat ${chatId} sent no event stream.`);

	return readEventsUntil<RepoChatEvent, { events: RepoChatEvent[]; reply: RepoChatMessage }>(
		response.body,
		(event) => {
			const reply = closedReply(event);

			events.push(event);

			return reply ? { events, reply } : undefined;
		},
		'its reply closed'
	);
}

/** The closed reply an event shows: a closed reply message, or the last message of a snapshot. */
function closedReply(event: RepoChatEvent): RepoChatMessage | undefined {
	let message: RepoChatMessage | undefined;

	if (event.type === 'message') message = event.message;
	if (event.type === 'snapshot') message = event.chat.messages.at(-1);

	return message?.from === 'assistant' && message.status !== 'streaming' ? message : undefined;
}

test('a chat cannot open on a repository Recoder does not track', async () => {
	const response = await post('/api/chats', { repoId: 'missing', text: 'What does this repo do?' });

	expect(response.status).toBe(404);
	expect(await db.repoChats.list()).toEqual([]);
});

test('malformed and over-long input is refused before anything is saved', async () => {
	const repo = await trackedRepo();

	for (const body of [null, {}, { repoId: repo.id }, { repoId: repo.id, text: '   ' }]) {
		expect((await post('/api/chats', body)).status).toBe(400);
	}

	expect((await post('/api/chats', { repoId: repo.id, text: 'x'.repeat(MAX_CHAT_MESSAGE_CHARS + 1) })).status).toBe(
		400
	);

	expect((await app.request('/api/chats?limit=0')).status).toBe(400);
	expect(await db.repoChats.list()).toEqual([]);

	streamingModel(['Fine.']);

	const chat = await startChat(repo.id, 'Hello');

	await replySettled(chat.id);
	expect((await post(`/api/chats/${chat.id}/messages`, { text: '' })).status).toBe(400);
	expect((await post('/api/chats/missing/messages', { text: 'Hello' })).status).toBe(404);
	expect((await post('/api/chats/missing/stop', { messageId: chat.messages[1].id })).status).toBe(404);
	expect((await post(`/api/chats/${chat.id}/stop`, {})).status).toBe(400);
});

test('with no model set up, a chat does not open and the error says where to pick one', async () => {
	const repo = await trackedRepo();

	setReviewOverrides({});

	const response = await post('/api/chats', { repoId: repo.id, text: 'Hello' });

	expect(response.status).toBe(409);
	expect(await response.json()).toMatchObject({ error: expect.stringContaining('Settings'), action: 'settings' });
	expect(await db.repoChats.list()).toEqual([]);
});

test('a chat records who opened it and the model calls of its replies under its own id', async () => {
	const repo = await trackedRepo();

	streamingModel(['Fine.']);

	const chat = await startChat(repo.id, 'Hello');

	await replySettled(chat.id);

	expect((await db.repoChats.get(chat.id))?.startedBy).toBe('owner');

	const metrics = await reviewMetrics.get(chat.id);

	expect(metrics?.calls).toHaveLength(1);
	expect(metrics?.calls[0]).toMatchObject({ model: 'lead', scope: 'discussion', status: 'completed' });
	expect(metrics?.calls[0].at).toBeString();

	await reviewMetrics.delete(chat.id);
});

test('a chat whose repository is no longer tracked takes no new messages', async () => {
	const repo = await trackedRepo();

	streamingModel(['Fine.']);

	const chat = await startChat(repo.id, 'Hello');

	await replySettled(chat.id);
	await db.repos.delete(repo.id);

	expect((await post(`/api/chats/${chat.id}/messages`, { text: 'And now?' })).status).toBe(409);
	expect((await db.repoChats.get(chat.id))?.messages).toHaveLength(2);
});

test('a reply streams on the events route, answered from the repository files the message names', async () => {
	const repo = await trackedRepo({ 'README.md': '# Shop\n', 'src/cart/total.ts': 'export const TAX_RATE = 0.2;\n' });
	const model = streamingModel(['The tax rate ', 'is 20%.']);
	const chat = await startChat(repo.id, 'What tax rate does total.ts use?');
	const { events, reply } = await eventsUntilReplyCloses(chat.id);

	expect(chat.title).toBe('What tax rate does total.ts use?');
	expect(events[0]).toMatchObject({ type: 'snapshot', chat: { id: chat.id, repoId: repo.id } });
	expect(reply).toMatchObject({ from: 'assistant', status: 'done', text: 'The tax rate is 20%.', model: 'lead' });

	const prompt = JSON.stringify(JSON.parse(model.bodies[0]).messages);

	expect(prompt).toContain('TAX_RATE = 0.2');
	expect(prompt).toContain('# Shop');
	expect(prompt).toContain('What tax rate does total.ts use?');

	expect((await (await app.request(`/api/chats?repoId=${repo.id}`)).json()) as unknown[]).toEqual([
		expect.objectContaining({ id: chat.id, title: chat.title })
	]);
});

test('a reply stopped midway keeps its partial text, closes as done, and the chat takes the next message', async () => {
	const repo = await trackedRepo();

	streamingModel(['Partial answer'], true);

	const chat = await startChat(repo.id, 'Explain the checkout flow');

	await replyHolds(chat.id, 'Partial answer');
	expect((await post(`/api/chats/${chat.id}/messages`, { text: 'Too soon' })).status).toBe(409);

	const stop = await post(`/api/chats/${chat.id}/stop`, { messageId: chat.messages[1].id });

	expect(await stop.json()).toEqual({ stopped: true });
	await replySettled(chat.id);

	const saved = (await (await app.request(`/api/chats/${chat.id}`)).json()) as RepoChat;

	expect(saved.messages.at(-1)).toMatchObject({ status: 'done', stopped: true, text: 'Partial answer' });
	expect(saved).not.toHaveProperty('writer');

	streamingModel(['Sure.']);
	expect((await post(`/api/chats/${chat.id}/messages`, { text: 'Go on' })).status).toBe(202);
	await replySettled(chat.id);
	expect((await db.repoChats.get(chat.id))?.messages.at(-1)).toMatchObject({ status: 'done', text: 'Sure.' });
});

test('asking to review a pull request already under review points to that review instead of starting another', async () => {
	const repo = await trackedRepo();
	const at = new Date().toISOString();

	const review = await db.reviews.set({
		id: crypto.randomUUID(),
		repoId: repo.id,
		prNumber: 42,
		headSha: 'abc',
		status: 'running',
		summary: null,
		findings: [],
		runs: [],
		source: 'local',
		prTitle: 'Cart totals',
		prUrl: null,
		createdAt: at,
		updatedAt: at
	});

	const chat = await startChat(repo.id, 'Please review #42');

	await replySettled(chat.id);
	await db.reviews.delete(review.id);

	expect((await db.repoChats.get(chat.id))?.messages.at(-1)).toMatchObject({
		status: 'done',
		review: { id: review.id, prNumber: 42 }
	});
});

test('a stop for a reply that already closed leaves the next reply streaming', async () => {
	const repo = await trackedRepo();

	streamingModel(['Fine.']);

	const chat = await startChat(repo.id, 'Hello');

	await replySettled(chat.id);

	const model = streamingModel(['Partial answer'], true);

	expect((await post(`/api/chats/${chat.id}/messages`, { text: 'Go on' })).status).toBe(202);
	await replyHolds(chat.id, 'Partial answer');

	const late = await post(`/api/chats/${chat.id}/stop`, { messageId: chat.messages[1].id });

	expect(await late.json()).toEqual({ stopped: false });
	expect(model.signals[0]?.aborted).toBe(false);
	expect((await db.repoChats.get(chat.id))?.writer?.stopRequested).toBe(false);

	const open = (await db.repoChats.get(chat.id))?.messages.at(-1);

	await post(`/api/chats/${chat.id}/stop`, { messageId: open?.id });
	await replySettled(chat.id);
});

test('a stop another replica saves on the record aborts the model at the next save of the reply', async () => {
	const repo = await trackedRepo();
	const model = streamingModel(['Partial answer'], true);
	const chat = await startChat(repo.id, 'Explain the checkout flow');

	await replyHolds(chat.id, 'Partial answer');
	expect(await requestStop(chat.id, chat.messages[1].id)).toBe(true);
	await replySettled(chat.id);

	expect(model.signals[0]?.aborted).toBe(true);

	expect((await db.repoChats.get(chat.id))?.messages.at(-1)).toMatchObject({
		status: 'done',
		stopped: true,
		text: 'Partial answer'
	});
});

test('a failed save, even of the closed reply, loses nothing: the next save carries the whole reply', async () => {
	const repo = await trackedRepo();
	const refused = () => Promise.reject(new Error('The database went away.'));
	const logged = spyOn(console, 'error').mockImplementation(() => undefined);

	streamingModel(['The tax rate ', 'is 20%.']);
	spyOn(db.repoChats, 'update').mockImplementationOnce(refused).mockImplementationOnce(refused);

	const chat = await startChat(repo.id, 'What tax rate applies?');

	await replySettled(chat.id);

	expect(logged).toHaveBeenCalledTimes(2);

	expect((await db.repoChats.get(chat.id))?.messages.at(-1)).toMatchObject({
		status: 'done',
		text: 'The tax rate is 20%.'
	});

	expect((await db.repoChats.get(chat.id))?.writer).toBeUndefined();
});

test('a message’s images are listed on it, served by its chat and sent to the model with the conversation', async () => {
	const repo = await trackedRepo();
	const model = streamingModel(['The button is clipped.']);
	const response = await post('/api/chats', { repoId: repo.id, text: 'What is wrong here?', images: [imageUpload()] });
	const chat = (await response.json()) as RepoChat;

	await replySettled(chat.id);

	const [image] = chat.messages[0].images ?? [];
	const read = (await (await app.request(`/api/chats/${chat.id}`)).json()) as RepoChat;
	const turn = JSON.parse(model.bodies[0]).messages[1];

	expect(response.status).toBe(201);
	expect(image).toMatchObject({ name: 'bug.png', type: 'image/png', url: `/api/chats/${chat.id}/images/${image.id}` });
	expect(read.messages[0].images).toEqual([image]);
	expect((await app.request(image.url)).status).toBe(200);
	expect(turn.content).toContainEqual({ type: 'image_url', image_url: { url: imageDataUrl(imageUpload()) } });
});

test('images for a model that cannot read them are refused before a chat opens', async () => {
	const repo = await trackedRepo();

	setReviewOverrides({ orchestratorModelId: 'grok:grok-4.7' });

	const response = await post('/api/chats', { repoId: repo.id, text: 'What is wrong here?', images: [imageUpload()] });

	expect(response.status).toBe(400);

	expect(await response.json()).toEqual({
		error: "Grok Build can't read images; pick another model or remove the images."
	});

	expect(await db.repoChats.list()).toEqual([]);
});

test('deleting a chat that is still replying stops the reply and removes the chat and its images', async () => {
	const repo = await trackedRepo();
	const model = streamingModel(['Partial answer'], true);
	const response = await post('/api/chats', { repoId: repo.id, text: 'What is wrong here?', images: [imageUpload()] });
	const chat = (await response.json()) as RepoChat;
	const [image] = chat.messages[0].images ?? [];

	await replyHolds(chat.id, 'Partial answer');

	const deleted = await app.request(`/api/chats/${chat.id}`, { method: 'DELETE' });

	await replySettled(chat.id);

	expect(deleted.status).toBe(204);
	expect(model.signals[0]?.aborted).toBe(true);
	expect(await db.repoChats.get(chat.id)).toBeUndefined();
	expect((await app.request(`/api/chats/${chat.id}`)).status).toBe(404);
	expect((await app.request(image.url)).status).toBe(404);
});

test('deleting a chat that does not exist answers 404', async () => {
	const response = await app.request('/api/chats/missing', { method: 'DELETE' });

	expect(response.status).toBe(404);
	expect(await response.json()).toEqual({ error: 'Chat not found.' });
});
