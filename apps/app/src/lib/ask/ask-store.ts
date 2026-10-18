import { MAX_CHAT_MESSAGE_CHARS, type DiscussMessage, type DiscussResponse } from '@recoder/shared';
import { create } from 'zustand';

import { chatApi } from '../api/chat';
import { ApiError, isOffline } from '../api/http';
import { chatFailure, type ChatFailure } from './failure';
import { askAgent, discussFinding, type AskItem } from './item';
import { localId } from './local-id';
import { sampleDiscuss } from './sample-reply';
import { readThreads, writeThreads } from './saved-threads';

/** A reply streaming in, finished, stopped by the reader, or cut short by a failure. */
type ReplyState = 'streaming' | 'done' | 'stopped' | 'failed';

export interface AskMessage {
	id: string;
	role: 'user' | 'assistant';
	text: string;
	/** The model that wrote a finished reply. */
	model?: string;
	state: ReplyState;
	/** Why a `failed` reply got no full answer, kept so earlier failures still say why. */
	failure?: ChatFailure;
}

export interface AskThread {
	messages: AskMessage[];
}

/** The threads of one review, by item key. */
export type ReviewThreads = Record<string, AskThread>;

interface AskStore {
	/** Threads by review id, then by item key. */
	threads: Record<string, ReviewThreads>;
	/** Asks the reviewer about an item; the reply streams into its thread. */
	ask: (reviewId: string, item: AskItem, question: string, sample: boolean) => Promise<void>;
	/** Asks the thread's last question again, dropping the reply it failed to finish. */
	retry: (reviewId: string, item: AskItem, sample: boolean) => Promise<void>;
	/** Stops the reply streaming into a thread; what arrived stays. */
	stop: (reviewId: string, itemKey: string) => void;
}

export const EMPTY_THREAD: AskThread = { messages: [] };

/** The server reads at most this many earlier turns, each at most `MAX_CHAT_MESSAGE_CHARS` long. */
const HISTORY_TURNS = 50;

/** A reply in flight per thread, so Stop can abort it. */
const controllers = new Map<string, AbortController>();

function controllerKey(reviewId: string, itemKey: string): string {
	return `${reviewId}\n${itemKey}`;
}

/** True while a reply streams into the thread. */
export function isReplying(thread: AskThread): boolean {
	return thread.messages.at(-1)?.state === 'streaming';
}

/** True for a reply the reviewer finished, or one the reader stopped after it said something. */
function answered(message: AskMessage | undefined): message is AskMessage {
	return (
		message?.role === 'assistant' &&
		(message.state === 'done' || message.state === 'stopped') &&
		message.text.trim().length > 0
	);
}

/**
 * The turns before a question, as the discuss endpoint reads them: each
 * question with the reply it got. A question that got no reply, or only part
 * of one before a failure, is left out with that part, so the turns alternate.
 */
function historyOf(messages: AskMessage[]): DiscussMessage[] {
	return messages
		.flatMap((message, index) => {
			const next = messages[index + 1];

			return message.role === 'user' && answered(next) ? [message, next] : [];
		})
		.slice(-HISTORY_TURNS)
		.map((message) => ({ role: message.role, body: message.text.slice(0, MAX_CHAT_MESSAGE_CHARS) }));
}

/**
 * Only a request that never got an answer is worth one more try: one that
 * never reached the server, a stream that dropped while it was read (a
 * `TypeError`), or a 5xx. A refusal the server will repeat (no model, no diff
 * yet) and an error frame (a plain `Error` with the server's words, such as a
 * model timeout) are its answer, shown at once.
 */
function worthRetrying(error: unknown): boolean {
	return isOffline(error) || error instanceof TypeError || (error instanceof ApiError && error.status >= 500);
}

export const useAsk = create<AskStore>((set, get) => {
	function threadOf(reviewId: string, itemKey: string): AskThread {
		return get().threads[reviewId]?.[itemKey] ?? EMPTY_THREAD;
	}

	function patchThread(reviewId: string, itemKey: string, update: (thread: AskThread) => AskThread): void {
		set((state) => {
			const review = state.threads[reviewId] ?? {};

			return {
				threads: { ...state.threads, [reviewId]: { ...review, [itemKey]: update(review[itemKey] ?? EMPTY_THREAD) } }
			};
		});
	}

	function patchMessage(reviewId: string, itemKey: string, id: string, update: (message: AskMessage) => AskMessage) {
		patchThread(reviewId, itemKey, (thread) => ({
			...thread,
			messages: thread.messages.map((message) => (message.id === id ? update(message) : message))
		}));
	}

	function save(reviewId: string): void {
		writeThreads(reviewId, get().threads[reviewId] ?? {});
	}

	/** The real endpoint, or the scripted sample. */
	function discuss(
		reviewId: string,
		item: AskItem,
		question: string,
		history: DiscussMessage[],
		sample: boolean,
		onToken: (text: string) => void,
		signal: AbortSignal
	): Promise<DiscussResponse> {
		if (sample) return sampleDiscuss(item, question, onToken, signal);

		const input = { agent: askAgent(item), finding: discussFinding(item), history, question };

		return chatApi.discuss(reviewId, input, onToken, signal);
	}

	/**
	 * Streams a reply into the thread. A stream that drops before its first
	 * word is tried once more; after that, the reply is marked failed with what
	 * arrived and why, and the failure shows under it. A stopped reply keeps
	 * its words and shows no error.
	 */
	async function reply(
		reviewId: string,
		item: AskItem,
		question: string,
		history: DiscussMessage[],
		sample: boolean
	): Promise<void> {
		const key = controllerKey(reviewId, item.key);
		const controller = new AbortController();
		const id = localId('ask');
		const streamed = () => threadOf(reviewId, item.key).messages.find((message) => message.id === id)?.text ?? '';
		const onToken = (text: string) => patchMessage(reviewId, item.key, id, (m) => ({ ...m, text: m.text + text }));
		const attempt = () => discuss(reviewId, item, question, history, sample, onToken, controller.signal);

		controllers.set(key, controller);

		patchThread(reviewId, item.key, (thread) => ({
			messages: [...thread.messages, { id, role: 'assistant', text: '', state: 'streaming' }]
		}));

		save(reviewId);

		try {
			const result = await attempt().catch((error: unknown) => {
				if (controller.signal.aborted || streamed() || !worthRetrying(error)) throw error;

				return attempt();
			});

			patchMessage(reviewId, item.key, id, (m) => ({
				...m,
				text: result.reply || m.text,
				model: result.model,
				state: 'done'
			}));
		} catch (error) {
			patchMessage(reviewId, item.key, id, (m) =>
				controller.signal.aborted ? { ...m, state: 'stopped' } : { ...m, state: 'failed', failure: chatFailure(error) }
			);
		} finally {
			controllers.delete(key);
			save(reviewId);
		}
	}

	return {
		threads: readThreads(),

		async ask(reviewId, item, question, sample) {
			const text = question.trim();

			if (!text || controllers.has(controllerKey(reviewId, item.key))) return;

			const history = historyOf(threadOf(reviewId, item.key).messages);

			patchThread(reviewId, item.key, (thread) => ({
				messages: [...thread.messages, { id: localId('ask'), role: 'user', text, state: 'done' }]
			}));

			await reply(reviewId, item, text, history, sample);
		},

		async retry(reviewId, item, sample) {
			const { messages } = threadOf(reviewId, item.key);
			const at = messages.findLastIndex((message) => message.role === 'user');

			if (at < 0 || controllers.has(controllerKey(reviewId, item.key))) return;

			patchThread(reviewId, item.key, () => ({ messages: messages.slice(0, at + 1) }));

			await reply(reviewId, item, messages[at].text, historyOf(messages.slice(0, at)), sample);
		},

		stop(reviewId, itemKey) {
			controllers.get(controllerKey(reviewId, itemKey))?.abort();
		}
	};
});
