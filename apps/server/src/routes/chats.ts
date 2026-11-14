import { Hono, type Context } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import { z } from 'zod';
import { MAX_CHAT_MESSAGE_CHARS, type RepoChatEvent, type RepoChatMessage } from '@recoder/shared';
import { imageBodyLimit, refuseUnreadImages, serveImage } from '../attachments/image-http';
import { deleteChatImages, withSavedImages } from '../attachments/image-store';
import { imageProblem, imagesSchema } from '../attachments/image-upload';
import { withStarterModels } from '../models/model-policy';
import { configForOrchestrator } from '../models/models';
import { requestAccountId } from '../accounts/enforcement';
import {
	chatTitle,
	newChat,
	newTurn,
	publicChat,
	withImages,
	WRITER_STALE_MS,
	type StoredRepoChat
} from '../repo-chat/chat-record';
import { startReply, stopLocalReply } from '../repo-chat/chat-reply';
import {
	addTurn,
	deleteChat,
	loadChat,
	openChat,
	recentChats,
	RepoChatError,
	requestStop,
	subscribeRepoChat
} from '../repo-chat/chat-turns';
import { postgres, recordVersion } from '../storage/backend';
import { db } from '../store';
import { EVENT_HEARTBEAT_MS } from './reviews/event-payload';

/**
 * How often an open event stream reads the chat again. With shared storage
 * the reply may be written on another replica, which cannot wake this one.
 */
const POLL_MS = postgres ? 250 : EVENT_HEARTBEAT_MS;

const idSchema = z.string().min(1).max(200);
const textSchema = z.string().trim().min(1).max(MAX_CHAT_MESSAGE_CHARS);
const startSchema = z.object({ repoId: idSchema, text: textSchema, images: imagesSchema });
const sendSchema = z.object({ text: textSchema, images: imagesSchema });
const stopSchema = z.object({ messageId: idSchema });

const listSchema = z.object({
	repoId: idSchema.optional(),
	limit: z.coerce.number().int().min(1).max(100).default(30)
});

const MESSAGE_RULE = `Enter a message of at most ${MAX_CHAT_MESSAGE_CHARS.toLocaleString('en-US')} characters.`;

const app = new Hono();

/** A person's message from the body, or the 400 that ends the request. */
async function parseMessage<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S> | Response> {
	const parsed = schema.safeParse(await c.req.json().catch(() => null));

	return parsed.success ? parsed.data : c.json({ error: imageProblem(parsed.error) ?? MESSAGE_RULE }, 400);
}

/** The `:id` chat, or the 404 that ends the request. */
async function requireChat(c: Context): Promise<StoredRepoChat | Response> {
	const id = idSchema.safeParse(c.req.param('id'));
	const chat = id.success ? await loadChat(id.data) : undefined;

	return chat ?? c.json({ error: 'Chat not found.' }, 404);
}

/** Recent chats, most recently active first: one repository's with `?repoId=`, else every one. */
app.get('/', async (c) => {
	const query = listSchema.safeParse(c.req.query());

	if (!query.success) return c.json({ error: 'Pass a repository id and a limit from 1 to 100.' }, 400);

	return c.json(await recentChats(query.data.repoId, query.data.limit));
});

/** Opens a chat on a tracked repository with its first message; the reply streams on `/:id/events`. */
app.post('/', imageBodyLimit, async (c) => {
	const body = await parseMessage(c, startSchema);

	if (body instanceof Response) return body;

	const repo = await db.repos.get(body.repoId);

	if (!repo) return c.json({ error: 'That repository is not tracked. Add it in Settings first.' }, 404);

	const startedBy = await requestAccountId(c);
	const config = await withStarterModels(startedBy, configForOrchestrator);
	const refused = refuseUnreadImages(c, body.images, config.provider);

	if (refused) return refused;

	const at = new Date().toISOString();
	const opened = newChat(repo.id, chatTitle(body.text), at, startedBy);

	return withSavedImages({ kind: 'chat', id: opened.id }, body.images, async (images) => {
		const turn = withImages(newTurn(body.text, config.model, at), images);
		const chat = await openChat(opened, turn);

		startReply({ chat, repo, turn, config });

		return c.json(publicChat(chat), 201);
	});
});

app.get('/:id', async (c) => {
	const chat = await requireChat(c);

	return chat instanceof Response ? chat : c.json(publicChat(chat));
});

/** Sends a message; the reply streams on `/:id/events`. Refused while the last reply is still being written. */
app.post('/:id/messages', imageBodyLimit, async (c) => {
	const chat = await requireChat(c);

	if (chat instanceof Response) return chat;

	const body = await parseMessage(c, sendSchema);

	if (body instanceof Response) return body;

	const repo = await db.repos.get(chat.repoId);

	if (!repo) return c.json({ error: 'This repository is no longer tracked, so the chat is read-only.' }, 409);

	const config = await withStarterModels(chat.startedBy, configForOrchestrator);
	const refused = refuseUnreadImages(c, body.images, config.provider);

	if (refused) return refused;

	try {
		const turn = await withSavedImages({ kind: 'chat', id: chat.id }, body.images, async (images) => {
			const added = withImages(newTurn(body.text, config.model, new Date().toISOString()), images);

			startReply({ chat: await addTurn(chat.id, added), repo, turn: added, config });

			return added;
		});

		return c.json<RepoChatMessage>(turn.user, 202);
	} catch (error) {
		if (error instanceof RepoChatError) return c.json({ error: error.message }, error.status);
		throw error;
	}
});

/** One image of the chat's messages; another chat's image is not found here. */
app.get('/:id/images/:imageId', (c) => serveImage(c, 'chat'));

/**
 * Stops the reply `messageId`, on whichever replica writes it. Says whether it
 * was still open; a stop for a reply that already closed stops nothing.
 */
app.post('/:id/stop', async (c) => {
	const chat = await requireChat(c);

	if (chat instanceof Response) return chat;

	const body = stopSchema.safeParse(await c.req.json().catch(() => null));

	if (!body.success) return c.json({ error: 'Pass the id of the reply to stop.' }, 400);

	const stopped = await requestStop(chat.id, body.data.messageId);

	stopLocalReply(chat.id, body.data.messageId);

	return c.json({ stopped });
});

/** Deletes the chat with its images, stopping a reply that is still being written. */
app.delete('/:id', async (c) => {
	const chat = await requireChat(c);

	if (chat instanceof Response) return chat;

	if (chat.writer) stopLocalReply(chat.id, chat.writer.messageId);

	if (!(await deleteChat(chat.id))) return c.json({ error: 'Chat not found.' }, 404);

	await deleteChatImages(chat.messages);

	return c.body(null, 204);
});

/** The chat as server-sent events: the whole chat, then each message as it changes, and a heartbeat. */
app.get('/:id/events', async (c) => {
	const chat = await requireChat(c);

	if (chat instanceof Response) return chat;
	c.header('X-Accel-Buffering', 'no');

	const response = streamSSE(c, (stream) => streamChat(stream, chat));

	response.headers.set('Cache-Control', 'no-cache, no-transform');

	return response;
});

/**
 * Follows one chat until the client leaves or the chat is gone. Every change
 * this server saves wakes the stream at once. Every `POLL_MS` it also reads
 * the record's version, which finds a reply written on another replica, and
 * reads the whole chat only when that changed, or when a reply has been
 * quiet long enough that its writer may be gone. It sends only the messages
 * that changed since it last looked, and reads the chat once as it starts,
 * for a change saved after the route first read it.
 */
async function streamChat(stream: SSEStreamingApi, opened: StoredRepoChat): Promise<void> {
	const sent = new Map<string, string | null>();
	let changed = true;
	let wake: (() => void) | undefined;
	let lastHeartbeat = Date.now();
	let version: string | undefined;
	let lastChangeAt = performance.now();

	const send = (event: RepoChatEvent) => stream.writeSSE({ data: JSON.stringify(event) });

	const unsubscribe = subscribeRepoChat(opened.id, () => {
		changed = true;
		wake?.();
	});

	stream.onAbort(() => wake?.());

	try {
		let chat: StoredRepoChat | undefined = opened;

		await send({ type: 'snapshot', chat: publicChat(chat) });
		for (const message of chat.messages) remember(sent, message);

		while (!stream.aborted) {
			const local = changed || (await nextChange((resolve) => (wake = resolve)));

			changed = false;

			if (stream.aborted) return;

			const current = local ? undefined : await recordVersion('repo_chats', opened.id);
			const moved = local || current !== version;

			version = current;
			if (moved) lastChangeAt = performance.now();

			const quiet = chat.writer !== undefined && performance.now() - lastChangeAt >= WRITER_STALE_MS;

			if (moved || quiet) {
				chat = await loadChat(opened.id);

				if (!chat || stream.aborted) return;

				for (const message of changedMessages(chat, sent)) {
					remember(sent, message);
					await send({ type: 'message', message });
				}
			}

			if (Date.now() - lastHeartbeat >= EVENT_HEARTBEAT_MS) {
				lastHeartbeat = Date.now();
				await send({ type: 'heartbeat', at: new Date(lastHeartbeat).toISOString() });
			}
		}
	} finally {
		unsubscribe();
	}
}

/**
 * Notes what the stream sent of a message: its JSON while it may still
 * change, or null once it is closed, since a closed message never changes.
 */
function remember(sent: Map<string, string | null>, message: RepoChatMessage): void {
	sent.set(message.id, message.status === 'streaming' ? JSON.stringify(message) : null);
}

/** The messages that are new or changed since the stream sent them, without comparing closed ones again. */
function changedMessages(chat: StoredRepoChat, sent: Map<string, string | null>): RepoChatMessage[] {
	return chat.messages.filter((message) => {
		const last = sent.get(message.id);

		return last === undefined || (last !== null && last !== JSON.stringify(message));
	});
}

/** Waits for a wake-up or `POLL_MS`, whichever comes first. True when a change on this server woke it. */
function nextChange(listen: (resolve: () => void) => void): Promise<boolean> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(false), POLL_MS);

		listen(() => {
			clearTimeout(timer);
			resolve(true);
		});
	});
}

export default app;
