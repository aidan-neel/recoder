import type { PullAttachment } from '@recoder/shared';
import { create } from 'zustand';

interface DraftAttachments {
	/** The pull requests waiting to go with the next message, by conversation. */
	byConversation: Record<string, PullAttachment[]>;
	attach: (conversationId: string, attachment: PullAttachment) => void;
	remove: (conversationId: string, attachment: PullAttachment) => void;
	clear: (conversationId: string) => void;
}

function same(a: PullAttachment, b: PullAttachment): boolean {
	return a.repoId === b.repoId && a.number === b.number;
}

/** Pull requests attached to a conversation's next message: "Message author" puts the pull request here before it opens the conversation. */
export const useDraftAttachments = create<DraftAttachments>((set) => ({
	byConversation: {},

	attach: (id, attachment) =>
		set((state) => {
			const held = state.byConversation[id] ?? [];

			return held.some((item) => same(item, attachment))
				? state
				: { byConversation: { ...state.byConversation, [id]: [...held, attachment] } };
		}),

	remove: (id, attachment) =>
		set((state) => ({
			byConversation: {
				...state.byConversation,
				[id]: (state.byConversation[id] ?? []).filter((item) => !same(item, attachment))
			}
		})),

	clear: (id) =>
		set((state) => {
			const { [id]: _cleared, ...rest } = state.byConversation;

			return { byConversation: rest };
		})
}));
