import {
	MAX_CHAT_MESSAGE_CHARS,
	MAX_FINDING_MESSAGE_CHARS,
	type DiscussFinding,
	type DiscussMessage,
	type Finding
} from '@recoder/shared';

import { ApiError, isOffline } from '../api/http';
import type { SessionContext } from '../pull/session-state';
import { chatFailure, type ChatFailure } from './failure';
import { localId } from './local-id';
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
	/** ISO time it was asked or answered. */
	at?: string;
}

export interface AskThread {
	messages: AskMessage[];
}

export const EMPTY_THREAD: AskThread = { messages: [] };

/** The server reads at most this many earlier turns, each at most `MAX_CHAT_MESSAGE_CHARS` long. */
const HISTORY_TURNS = 50;

/** The reviewer role that answers when the finding does not name one. */
const DEFAULT_AGENT = 'reviewer';

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
 * `TypeError`), or a 5xx. A refusal the server will repeat and an error frame
 * (a plain `Error` with the server's words) are its answer, shown at once.
 */
function worthRetrying(error: unknown): boolean {
	return isOffline(error) || error instanceof TypeError || (error instanceof ApiError && error.status >= 500);
}

/** The finding in the shape the discuss endpoint reads. */
function discussFinding(finding: Finding): DiscussFinding {
	const line = finding.line ?? 1;

	return {
		file: finding.file,
		line,
		endLine: Math.max(finding.endLine ?? line, line),
		severity: finding.severity,
		message: `${finding.title ?? ''}\n\n${finding.message}`.trim().slice(0, MAX_FINDING_MESSAGE_CHARS),
		agent: finding.agent || DEFAULT_AGENT
	};
}

/** Conversations about single findings of the followed review, kept for the tab's session. */
export function createBugChat(context: SessionContext) {
	const { client, state } = context;
	const controllers = new Map<string, AbortController>();

	function threadOf(bugId: string): AskThread {
		return state.getState().threads[bugId] ?? EMPTY_THREAD;
	}

	function patchThread(bugId: string, update: (thread: AskThread) => AskThread): void {
		state.setState((current) => ({
			threads: { ...current.threads, [bugId]: update(current.threads[bugId] ?? EMPTY_THREAD) }
		}));
	}

	function patchMessage(bugId: string, id: string, update: (message: AskMessage) => AskMessage): void {
		patchThread(bugId, (thread) => ({
			messages: thread.messages.map((message) => (message.id === id ? update(message) : message))
		}));
	}

	function save(): void {
		const { review, threads } = state.getState();

		if (review) writeThreads(review.id, threads);
	}

	/** The followed review and the finding the thread is about. */
	function subject(bugId: string): { reviewId: string; finding: Finding } {
		const review = state.getState().review;
		const finding = review?.findings.find((candidate) => candidate.id === bugId);

		if (!review || !finding) throw new Error('That finding is no longer in the review.');

		return { reviewId: review.id, finding };
	}

	/**
	 * Streams a reply into the thread. A stream that drops before its first
	 * word is tried once more; after that, the reply is marked failed with what
	 * arrived and why. A stopped reply keeps its words and shows no error.
	 */
	async function reply(bugId: string, question: string, history: DiscussMessage[]): Promise<void> {
		const { reviewId, finding } = subject(bugId);
		const controller = new AbortController();
		const id = localId('ask');
		const streamed = () => threadOf(bugId).messages.find((message) => message.id === id)?.text ?? '';
		const onToken = (text: string) => patchMessage(bugId, id, (m) => ({ ...m, text: m.text + text }));
		const about = discussFinding(finding);
		const input = { agent: about.agent, finding: about, history, question };
		const attempt = () => client.discuss(reviewId, input, onToken, controller.signal);

		controllers.set(bugId, controller);

		patchThread(bugId, (thread) => ({
			messages: [...thread.messages, { id, role: 'assistant', text: '', state: 'streaming' }]
		}));

		save();

		try {
			const result = await attempt().catch((error: unknown) => {
				if (controller.signal.aborted || streamed() || !worthRetrying(error)) throw error;

				return attempt();
			});

			patchMessage(bugId, id, (m) => ({
				...m,
				text: result.reply || m.text,
				model: result.model,
				state: 'done',
				at: new Date().toISOString()
			}));
		} catch (error) {
			patchMessage(bugId, id, (m) =>
				controller.signal.aborted ? { ...m, state: 'stopped' } : { ...m, state: 'failed', failure: chatFailure(error) }
			);
		} finally {
			controllers.delete(bugId);
			save();
		}
	}

	return {
		/** Takes the threads this tab saved for the review. */
		load(reviewId: string): void {
			state.setState({ threads: readThreads(reviewId) });
		},

		/** Asks about the finding; the reply streams into its thread. */
		async ask(bugId: string, question: string): Promise<void> {
			const text = question.trim();

			if (!text || controllers.has(bugId)) return;

			const history = historyOf(threadOf(bugId).messages);
			const at = new Date().toISOString();

			patchThread(bugId, (thread) => ({
				messages: [...thread.messages, { id: localId('ask'), role: 'user', text, state: 'done', at }]
			}));

			await reply(bugId, text, history);
		},

		/** Asks the thread's last question again, dropping the reply it failed to finish. */
		async retry(bugId: string): Promise<void> {
			const { messages } = threadOf(bugId);
			const at = messages.findLastIndex((message) => message.role === 'user');

			if (at < 0 || controllers.has(bugId)) return;

			patchThread(bugId, () => ({ messages: messages.slice(0, at + 1) }));

			await reply(bugId, messages[at].text, historyOf(messages.slice(0, at)));
		},

		/** Stops the reply streaming into the thread; what arrived stays. */
		stop(bugId: string): void {
			controllers.get(bugId)?.abort();
		}
	};
}
