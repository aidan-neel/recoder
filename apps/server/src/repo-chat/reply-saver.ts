import type { RepoChatMessage } from '@recoder/shared';
import { saveReply, type SaveOutcome } from './chat-turns';

/** How many times a reply's closing save is tried before the reply is closed as failed instead. */
const CLOSE_ATTEMPTS = 4;

/** The wait before the first retry of a closing save; each later retry waits twice as long. */
const FIRST_RETRY_MS = 250;

/** What a reply says when its closing save never went through. */
const NOT_SAVED = 'Recoder could not save the end of this reply. Ask again.';

/**
 * Saves one streamed reply to its chat. One save runs at a time and at most
 * one waits behind it: a newer snapshot replaces the waiting one, because
 * every save holds the whole reply. A save that fails is logged and the
 * next one carries the same text, so one failed write loses nothing.
 */
export class ReplySaver {
	private running: Promise<void> | null = null;
	private waiting: RepoChatMessage | null = null;

	constructor(
		private readonly chatId: string,
		private readonly heard: (outcome: SaveOutcome) => void
	) {}

	/** Saves the reply as it now stands, once the save before it is done. */
	save(reply: RepoChatMessage): void {
		this.waiting = structuredClone(reply);
		this.running ??= this.saveWaiting();
	}

	/**
	 * Saves the closed reply after the save already running, trying again
	 * with a growing wait while the store refuses it. When every try fails,
	 * it saves the reply as failed. Throws when even that fails; the reply
	 * then closes as interrupted once its writer has been quiet long enough.
	 */
	async close(reply: RepoChatMessage): Promise<void> {
		this.waiting = null;

		while (this.running) await this.running;

		for (let attempt = 1; attempt <= CLOSE_ATTEMPTS; attempt++) {
			try {
				await saveReply(this.chatId, reply);

				return;
			} catch (error) {
				console.error(`[chat] could not save a closed reply (try ${attempt} of ${CLOSE_ATTEMPTS})`, error);
			}

			if (attempt < CLOSE_ATTEMPTS) await Bun.sleep(FIRST_RETRY_MS * 2 ** (attempt - 1));
		}

		await saveReply(this.chatId, { ...reply, status: 'error', failure: { reason: NOT_SAVED } });
	}

	private async saveWaiting(): Promise<void> {
		for (let reply = this.waiting; reply; reply = this.waiting) {
			this.waiting = null;

			try {
				this.heard(await saveReply(this.chatId, reply));
			} catch (error) {
				console.error('[chat] could not save a streaming reply; the next save carries its text', error);
			}
		}

		this.running = null;
	}
}
