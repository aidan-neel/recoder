import { ORCHESTRATOR_ID } from '@recoder/shared';
import { create } from 'zustand';

import { chatApi } from '../api/chat';
import { useReview } from '../review/review-store';
import { errorToast } from '../shell/notify';
import { orchestratorMessages, type Outgoing } from './conversation';
import { chatFailure } from './failure';
import { localId } from './local-id';

interface ReviewChatStore {
	/** What this tab sent to Orchestrator, by review id, kept so a remounted conversation still shows it. */
	outbox: Record<string, Outgoing[]>;
	/** The reply Stop was pressed on, by review id. */
	stopping: Record<string, string>;
	/** Shows the message at once and sends it; the reply arrives on the review's event stream. */
	send: (reviewId: string, text: string) => void;
	/** Sends a message the server refused again. */
	resend: (reviewId: string, key: string) => void;
	/** Drops a message the server refused. */
	discard: (reviewId: string, key: string) => void;
	/** Stops the reply in flight; a failure says so in a toast. */
	stop: (reviewId: string, replyId: string) => Promise<void>;
}

/** An empty outbox with one identity, so selectors stay stable. */
export const NO_OUTGOING: Outgoing[] = [];

/** How many messages the shown review's conversation has now; a copy of what is sent next can only follow them. */
function conversationLength(): number {
	return orchestratorMessages(useReview.getState().progress?.messages).length;
}

/**
 * The conversation with Orchestrator outside any one component: messages on
 * their way or refused, and the reply being stopped. Switching between the
 * overview and a decision, or closing the ask column, keeps them.
 */
export const useReviewChat = create<ReviewChatStore>((set, get) => {
	function update(reviewId: string, change: (list: Outgoing[]) => Outgoing[]): void {
		set((state) => ({ outbox: { ...state.outbox, [reviewId]: change(state.outbox[reviewId] ?? NO_OUTGOING) } }));
	}

	function patch(reviewId: string, key: string, change: Partial<Outgoing>): void {
		update(reviewId, (list) => list.map((outgoing) => (outgoing.key === key ? { ...outgoing, ...change } : outgoing)));
	}

	/** Sends one message; a retry counts its copy from the conversation as it stands now. */
	async function deliver(reviewId: string, key: string, text: string): Promise<void> {
		patch(reviewId, key, { state: 'pending', failure: undefined, after: conversationLength() });

		try {
			const sent = await chatApi.send(reviewId, ORCHESTRATOR_ID, text);

			patch(reviewId, key, { state: 'sent', serverId: sent.id });
		} catch (error) {
			patch(reviewId, key, { state: 'failed', failure: chatFailure(error) });
		}
	}

	return {
		outbox: {},
		stopping: {},

		send(reviewId, text) {
			const key = localId('out');

			update(reviewId, (list) => [...list, { key, text, state: 'pending', after: conversationLength() }]);
			void deliver(reviewId, key, text);
		},

		resend(reviewId, key) {
			const outgoing = get().outbox[reviewId]?.find((candidate) => candidate.key === key);

			if (outgoing) void deliver(reviewId, key, outgoing.text);
		},

		discard(reviewId, key) {
			update(reviewId, (list) => list.filter((outgoing) => outgoing.key !== key));
		},

		async stop(reviewId, replyId) {
			set((state) => ({ stopping: { ...state.stopping, [reviewId]: replyId } }));

			try {
				await chatApi.stop(reviewId, ORCHESTRATOR_ID);
			} catch (error) {
				set((state) => ({ stopping: { ...state.stopping, [reviewId]: '' } }));
				errorToast('Couldn’t stop the reply', chatFailure(error).message);
			}
		}
	};
});
