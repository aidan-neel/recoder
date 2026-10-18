import { create } from 'zustand';

interface DraftStore {
	/** Unsent text by conversation key. */
	drafts: Record<string, string>;
	setDraft: (key: string, text: string) => void;
}

/** The key of one conversation's draft: a decision's or receipt's thread, or the review's chat with Orchestrator. */
export function draftKey(reviewId: string, conversation: string): string {
	return `${reviewId}\n${conversation}`;
}

/**
 * What the person typed and has not sent, one draft per conversation, so text
 * written about one decision stays with it when the reader moves on. Only the
 * composer reads it, so typing re-renders the field and not the transcript.
 */
export const useDrafts = create<DraftStore>((set) => ({
	drafts: {},
	setDraft: (key, text) => set((state) => ({ drafts: { ...state.drafts, [key]: text } }))
}));
