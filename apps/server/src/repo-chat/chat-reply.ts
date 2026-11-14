import type { Repo, RepoChatMessage } from '@recoder/shared';
import { LlmError, streamChatCompletion } from '../models/llm';
import { withUsageMetrics } from '../models/metrics';
import { modelFailure } from '../models/model-failure';
import type { ModelConfig } from '../models/models';
import { settingsOperation } from '../storage/backend';
import { INTERRUPTED, MAX_REPLY_CHARS, WRITER_HEARTBEAT_MS, type ChatTurn, type StoredRepoChat } from './chat-record';
import { replyPrompt } from './chat-prompt';
import { requestedReview, reviewFromChat } from './chat-review';
import { citationsFor, TrailRecorder } from './chat-trail';
import { ReplySaver } from './reply-saver';

/** A streaming reply's text is saved at most this often while tokens arrive. */
const SAVE_EVERY_MS = 150;

/** What a reply that failed without a reason says. */
const NO_REASON = 'The model could not finish this reply. Try again.';

/** How long shutdown waits for this server's replies to save their close. */
const SHUTDOWN_WAIT_MS = 5000;

/** The abort reason of a reply cut short by shutdown, which closes as interrupted rather than stopped. */
const SHUTTING_DOWN = 'shutting down';

/** The reply to write: the chat as saved with its new turn, the repository it is about and the model to ask. */
export interface ReplyJob {
	chat: StoredRepoChat;
	repo: Repo;
	turn: ChatTurn;
	/** Resolved from the request's settings, so a settings change mid-reply does not switch models. */
	config: ModelConfig;
}

/** A reply this server is writing. */
interface LocalReply {
	messageId: string;
	controller: AbortController;
	done: Promise<void>;
}

/** The replies this server is writing, by chat, so each can be stopped here at once. */
const writing = new Map<string, LocalReply>();

/**
 * Writes the turn's reply in the background: the request that opened it
 * answers at once, and the reply streams into the chat's record whether or
 * not a page is watching. It reads settings from a snapshot of its own,
 * because the request's closes when the request returns.
 */
export function startReply(job: ReplyJob): void {
	const controller = new AbortController();

	const done = settingsOperation(() => writeReply(job, controller)).catch((error: unknown) => {
		console.error('[chat] could not save a repository chat reply', error);
	});

	writing.set(job.chat.id, { messageId: job.turn.reply.id, controller, done });

	void done.finally(() => {
		if (writing.get(job.chat.id)?.done === done) writing.delete(job.chat.id);
	});
}

/** Stops the reply `messageId` if this server writes it; another replica's stops through the chat's record. */
export function stopLocalReply(chatId: string, messageId: string): void {
	const reply = writing.get(chatId);

	if (reply?.messageId === messageId) reply.controller.abort();
}

/** Resolves once the reply this server is writing for the chat is saved in full. */
export async function replySettled(chatId: string): Promise<void> {
	await writing.get(chatId)?.done;
}

/**
 * Cuts short every reply this server writes and closes each as interrupted,
 * keeping its text, so a rolling update leaves no page waiting on a writer
 * that is gone. Waits at most `SHUTDOWN_WAIT_MS`; a reply still open after
 * that closes when a reader finds its writer quiet.
 */
export async function interruptLocalReplies(): Promise<void> {
	const open = [...writing.values()];

	if (open.length === 0) return;

	for (const reply of open) reply.controller.abort(SHUTTING_DOWN);

	const closed = Promise.all(open.map((reply) => reply.done)).then(() => true);

	if (!(await Promise.race([closed, Bun.sleep(SHUTDOWN_WAIT_MS).then(() => false)])))
		console.warn('[chat] some repository chat replies did not close before shutdown; readers close them later');
}

/**
 * Writes the reply and saves it as it grows. Every save reads whether a stop
 * was asked for and whether the reply is still this server's to write, and
 * aborts the model call when either says so. The closing save is done before
 * this resolves.
 */
async function writeReply(job: ReplyJob, controller: AbortController): Promise<void> {
	const reply: RepoChatMessage = { ...job.turn.reply };

	const saver = new ReplySaver(job.chat.id, (outcome) => {
		if (outcome !== 'saved') controller.abort();
	});

	let savedAt = 0;

	const save = () => {
		savedAt = Date.now();
		saver.save(reply);
	};

	const saveSoon = () => {
		if (Date.now() - savedAt >= SAVE_EVERY_MS) save();
	};

	const trail = new TrailRecorder(reply, saveSoon);

	const heartbeat = setInterval(save, WRITER_HEARTBEAT_MS);

	try {
		await answer(job, reply, trail, controller.signal, saveSoon);

		reply.status = reply.failure ? 'error' : 'done';
	} catch (error) {
		closeFailed(reply, error, controller.signal, job.config);
	} finally {
		trail.endThinking();
		clearInterval(heartbeat);
	}

	await saver.close(reply);
}

/** Fills in the reply: a review the message asked for, else the model's answer as it streams. */
async function answer(
	job: ReplyJob,
	reply: RepoChatMessage,
	trail: TrailRecorder,
	signal: AbortSignal,
	grew: () => void
): Promise<void> {
	const question = job.turn.user.text;
	const pull = requestedReview(question);

	if (pull !== null) {
		Object.assign(reply, await reviewFromChat(job.repo, pull, question, job.chat.startedBy));

		return;
	}

	trail.startReading();

	const { messages, files } = await replyPrompt(job.repo, job.chat, signal);

	trail.finishReading(files);

	const output = await withUsageMetrics(job.chat.id, 'discussion', () =>
		streamChatCompletion(
			{
				...job.config,
				signal,
				timeoutMs: 120_000,
				maxTokens: 16_000,
				messages,
				onReasoning: (delta) => trail.addReasoning(delta)
			},
			(chunk) => {
				trail.endThinking();
				reply.text = (reply.text + chunk).slice(0, MAX_REPLY_CHARS);
				grew();
			}
		)
	);

	reply.text = output.slice(0, MAX_REPLY_CHARS);
	trail.endThinking();
	reply.citations = await citationsFor(job.repo, reply.text, signal);
}

/**
 * Closes a reply that did not finish. A stopped reply keeps what arrived and
 * reads as done; one cut short by shutdown or a failure keeps it too and says
 * why, in words for people.
 */
function closeFailed(reply: RepoChatMessage, error: unknown, signal: AbortSignal, config: ModelConfig): void {
	if (signal.aborted && signal.reason === SHUTTING_DOWN) {
		reply.status = 'error';
		reply.failure = { reason: INTERRUPTED };

		return;
	}

	if (signal.aborted) {
		reply.status = 'done';
		reply.stopped = true;

		return;
	}

	if (!(error instanceof LlmError)) console.error('[chat] repository chat reply failed', error);

	reply.status = 'error';
	reply.failure = modelFailure(error, config, NO_REASON);
}
