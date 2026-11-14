import {
	withRepoChatMessage,
	type RepoChat,
	type RepoChatEvent,
	type RepoChatMessage,
	type RepoChatSummary,
	type SendRepoChatInput,
	type StartRepoChatInput
} from '@recoder/shared';

import type { StreamHandlers } from '../api/event-stream';
import { ApiError } from '../api/http';
import { endedTrail, LOOKUP_CITATIONS, LOOKUP_SCRIPT, scriptFor, TOUR_SCRIPT, trailAt } from './sample-chat-script';
import { CHUNK_MS, replyPieces } from './sample-replies';
import type { SampleWorld } from './sample-world';

/** The chat the sample opens with, at `/sample/chats/sample-chat`: a few turns about the sample's API repository. */
const SAMPLE_CHAT_ID = 'sample-chat';

/** How often a reply being played is put in the chat again, so its trail and words move smoothly. */
const TICK_MS = 40;

const UNSCRIPTED =
	'This is the sample, so its replies are scripted. Track a repository and ask about your own code from New review.';

/** The sample chat's thread, oldest first: the person's question, then Recoder's answer. */
const SAMPLE_THREAD: [string, string][] = [
	[
		'How does the rate limiter decide which bucket a request uses?',
		'It keys every request by tenant. The middleware reads `x-tenant-id` and passes it to `take` [middleware.ts:15](#cite:src/rate-limit/middleware.ts:15); the limiter keeps one bucket per key in a `Map` [limiter.ts:21](#cite:src/rate-limit/limiter.ts:21).\n\nA request with no tenant header falls back to the key `anonymous`, so every unauthenticated client shares one bucket.'
	],
	[
		'Is that shared anonymous bucket a problem?',
		'Yes. Sign-up and login run before a tenant exists, so they all land in `anonymous`. One script that sends 100 requests a minute locks everyone else out of signing in.\n\nThe open review of #214 raised it as a high-severity bug and reproduced it with a test.'
	],
	[
		'What would you change?',
		"Key header-less requests by client address instead of one shared name:\n\n```ts\nconst key = c.req.header('x-tenant-id') ?? `ip:${clientAddress(c)}`;\n```\n\nBehind the proxy, read the first address in `x-forwarded-for`. Keep the reproduction test so the shared bucket can't come back."
	]
];

/** The sample's chats about a repository: one seeded thread, and scripted replies streamed the way the server streams real ones. */
export function createSampleRepoChats(world: SampleWorld) {
	const chats = new Map<string, RepoChat>();
	const followers = new Map<string, Set<StreamHandlers<RepoChatEvent>>>();

	const streams = new Map<
		string,
		{ messageId: string; timer: ReturnType<typeof setInterval>; finish: (stopped: boolean) => void }
	>();

	let sequence = 0;

	/** The seeded chat is added once, so deleting it does not bring it back. */
	let seeded = false;

	function nextId(kind: string): string {
		sequence += 1;

		return `sample-${kind}-${sequence}`;
	}

	function findChat(id: string): RepoChat {
		if (!seeded) {
			seeded = true;
			chats.set(SAMPLE_CHAT_ID, seededChat(world));
		}

		const chat = chats.get(id);

		if (!chat) throw new ApiError('Chat not found.', 404);

		return chat;
	}

	/** Puts a message in the chat, or replaces it there, and tells whoever follows the chat. */
	function put(chatId: string, message: RepoChatMessage): void {
		chats.set(chatId, { ...withRepoChatMessage(findChat(chatId), message), updatedAt: message.at });

		for (const handlers of followers.get(chatId) ?? []) handlers.onMessage({ type: 'message', message });
	}

	/** The person's message, then the reply played from its script: its trail first, then its words. */
	function ask(chatId: string, text: string): RepoChatMessage {
		const startedAt = Date.now();
		const at = new Date(startedAt).toISOString();
		const script = scriptFor(text);
		const pieces = replyPieces(script.answer || UNSCRIPTED);
		const user: RepoChatMessage = { id: nextId('message'), from: 'user', text, at, status: 'done' };

		const reply: RepoChatMessage = {
			id: nextId('message'),
			from: 'assistant',
			text: '',
			at,
			status: 'streaming',
			trail: []
		};

		let shown = 0;

		const finish = (stopped: boolean) => {
			clearInterval(streams.get(chatId)?.timer);
			streams.delete(chatId);

			put(chatId, {
				...reply,
				text: pieces.slice(0, shown).join(''),
				trail: endedTrail(trailAt(script, Date.now() - startedAt, startedAt), Date.now()),
				citations: script.citations,
				status: 'done',
				model: 'sample',
				...(stopped ? { stopped: true as const } : {})
			});
		};

		const tick = () => {
			const elapsed = Date.now() - startedAt;

			shown = elapsed < script.answerAt ? 0 : Math.floor((elapsed - script.answerAt) / CHUNK_MS) + 1;

			if (shown >= pieces.length) {
				finish(false);

				return;
			}

			put(chatId, { ...reply, text: pieces.slice(0, shown).join(''), trail: trailAt(script, elapsed, startedAt) });
		};

		put(chatId, user);
		put(chatId, reply);
		streams.set(chatId, { messageId: reply.id, timer: setInterval(tick, TICK_MS), finish });

		return user;
	}

	return {
		async repoChats(limit: number): Promise<RepoChatSummary[]> {
			findChat(SAMPLE_CHAT_ID);

			return [...chats.values()]
				.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
				.slice(0, limit)
				.map(({ id, repoId, title, createdAt, updatedAt }) => ({ id, repoId, title, createdAt, updatedAt }));
		},

		async deleteRepoChat(chatId: string): Promise<void> {
			findChat(chatId);
			streams.get(chatId)?.finish(true);
			chats.delete(chatId);
		},

		repoChat: async (chatId: string): Promise<RepoChat> => structuredClone(findChat(chatId)),

		async startRepoChat({ repoId, text }: StartRepoChatInput): Promise<{ id: string }> {
			if (!world.data().repos.some((repo) => repo.id === repoId))
				throw new ApiError('That repository is not tracked. Add it in Settings first.', 404);

			const at = new Date().toISOString();
			const id = nextId('chat');

			findChat(SAMPLE_CHAT_ID);

			chats.set(id, {
				id,
				repoId,
				title: text.trim().split('\n')[0].slice(0, 60),
				createdAt: at,
				updatedAt: at,
				messages: []
			});

			ask(id, text);

			return { id };
		},

		async sendRepoChat(chatId: string, { text }: SendRepoChatInput): Promise<RepoChatMessage> {
			findChat(chatId);

			if (streams.has(chatId))
				throw new ApiError('Recoder is still replying. Stop the reply or wait before you send another message.', 409);

			return ask(chatId, text);
		},

		async stopRepoChat(chatId: string, messageId: string): Promise<void> {
			const stream = streams.get(chatId);

			if (stream?.messageId !== messageId) return;

			stream.finish(true);
		},

		/** Follows a chat: the whole chat comes first, a moment later, as the server sends it. */
		followRepoChat(chatId: string, handlers: StreamHandlers<RepoChatEvent>): () => void {
			const set = followers.get(chatId) ?? new Set();

			set.add(handlers);
			followers.set(chatId, set);

			void Promise.resolve().then(() => {
				if (!set.has(handlers)) return;

				handlers.onConnection('live');
				handlers.onMessage({ type: 'snapshot', chat: structuredClone(findChat(chatId)) });
			});

			return () => set.delete(handlers);
		}
	};
}

/** The seeded chat, its turns a minute apart and ending a few minutes ago. */
function seededChat(world: SampleWorld): RepoChat {
	const repoId = world.data().repos[0]?.id ?? 'sample-api';
	const start = Date.now() - (SAMPLE_THREAD.length + 3) * 60_000;
	const at = (minute: number) => new Date(start + minute * 60_000).toISOString();

	const messages = SAMPLE_THREAD.flatMap(([question, answer], turn): RepoChatMessage[] => [
		{ id: `sample-chat-q${turn}`, from: 'user', text: question, at: at(turn), status: 'done' },
		{
			id: `sample-chat-a${turn}`,
			from: 'assistant',
			text: answer,
			at: at(turn),
			status: 'done',
			model: 'sample',
			trail: trailAt(turn === SAMPLE_THREAD.length - 1 ? TOUR_SCRIPT : LOOKUP_SCRIPT, Infinity, start + turn * 60_000),
			...(turn === 0 ? { citations: LOOKUP_CITATIONS } : {})
		}
	]);

	return {
		id: SAMPLE_CHAT_ID,
		repoId,
		title: 'How does the rate limiter decide which bucket a request uses?',
		createdAt: at(0),
		updatedAt: at(SAMPLE_THREAD.length - 1),
		messages
	};
}
