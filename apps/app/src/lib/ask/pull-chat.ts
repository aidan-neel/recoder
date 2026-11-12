import { plainly } from '../api/http';
import type { SessionContext } from '../pull/session-state';
import { orchestratorMessages, type Outgoing } from './conversation';
import { chatFailure } from './failure';
import { localId } from './local-id';

/** Opening a session for a pull request that has no review yet. */
interface DraftOpener {
	openDraft: () => Promise<string>;
}

/**
 * The conversation with Recoder about the whole pull request: what this page
 * sent, shown at once and kept until the review's events carry the server's
 * copy. On a pull request with no review, the first message opens a session.
 */
export function createPullChat(context: SessionContext, drafts: DraftOpener) {
	const { client, state } = context;

	/** How many messages the conversation has now; a copy of what is sent next can only follow them. */
	function conversationLength(): number {
		return orchestratorMessages(state.getState().progress?.messages).length;
	}

	function patch(key: string, change: Partial<Outgoing>): void {
		state.setState((current) => ({
			outbox: current.outbox.map((outgoing) => (outgoing.key === key ? { ...outgoing, ...change } : outgoing))
		}));
	}

	/** Sends one message; a failure marks it, and a retry counts its copy from the conversation as it stands then. */
	async function deliver(reviewId: string, key: string, text: string): Promise<void> {
		patch(key, { state: 'pending', failure: undefined, after: conversationLength() });

		try {
			const sent = await client.sendChat(reviewId, text);

			patch(key, { state: 'sent', serverId: sent.id });
		} catch (error) {
			patch(key, { state: 'failed', failure: chatFailure(error) });
		}
	}

	/** The followed review's id, or a new session's when the pull request has none. */
	async function sessionId(): Promise<string> {
		return state.getState().review?.id ?? drafts.openDraft();
	}

	return {
		async send(text: string): Promise<void> {
			const trimmed = text.trim();

			if (!trimmed) return;

			const key = localId('out');

			state.setState((current) => ({
				outbox: [...current.outbox, { key, text: trimmed, state: 'pending', after: conversationLength() }]
			}));

			try {
				await deliver(await sessionId(), key, trimmed);
			} catch (error) {
				patch(key, { state: 'failed', failure: chatFailure(error) });
			}
		},

		/** Sends a message the server refused again. */
		async resend(key: string): Promise<void> {
			const outgoing = state.getState().outbox.find((candidate) => candidate.key === key);
			const reviewId = state.getState().review?.id;

			if (outgoing && reviewId) await deliver(reviewId, key, outgoing.text);
		},

		/** Stops the reply being written; rejects with a plain sentence. */
		async stop(): Promise<void> {
			const reviewId = state.getState().review?.id;

			if (reviewId) await plainly(() => client.stopChat(reviewId));
		}
	};
}

export type PullChat = ReturnType<typeof createPullChat>;
