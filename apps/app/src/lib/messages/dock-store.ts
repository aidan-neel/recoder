import { create } from 'zustand';

/** What the message window shows: every conversation, or one of them. */
export type DockView = { kind: 'inbox' } | { kind: 'conversation'; conversationId: string };

interface DockState {
	/** The window's page; null while it is shut. */
	view: DockView | null;
	/**
	 * What the open window rose from: the launcher (`inbox`) or a conversation's head. Moving inside the window (a row of
	 * the inbox, the back arrow) keeps it, so only opening from another bubble raises a new window.
	 */
	origin: string;
	/** Conversations kept as heads by opening or minimising them, with when, so each stays until it goes quiet. */
	kept: Record<string, number>;
	/** The launcher: opens the inbox, or shuts the window it opened. */
	toggleInbox: () => void;
	/** Opens a conversation in the window; `fromInbox` keeps the window it was picked in. */
	openConversation: (conversationId: string, fromInbox?: boolean) => void;
	/** From a conversation back to every conversation, in the same window. */
	back: () => void;
	/** Shuts the window and keeps its conversation as a head. */
	minimise: () => void;
	/** Shuts the window; its head stays only while the conversation is active. */
	close: () => void;
}

/**
 * The floating messages: which window is open and which conversations stay as heads beside the launcher. It lives in
 * memory for the page, so a reload starts with the window shut and the heads drawn from recent activity alone.
 */
export const useDock = create<DockState>((set, get) => ({
	view: null,
	origin: 'inbox',
	kept: {},

	toggleInbox() {
		const { view, origin } = get();

		if (view && origin === 'inbox') set({ view: null });
		else set({ view: { kind: 'inbox' }, origin: 'inbox' });
	},

	openConversation(conversationId, fromInbox = false) {
		set((state) => ({
			view: { kind: 'conversation', conversationId },
			origin: fromInbox ? state.origin : conversationId,
			kept: { ...state.kept, [conversationId]: Date.now() }
		}));
	},

	back() {
		set({ view: { kind: 'inbox' } });
	},

	minimise() {
		const { view } = get();

		if (view?.kind === 'conversation') set((state) => ({ kept: { ...state.kept, [view.conversationId]: Date.now() } }));

		set({ view: null });
	},

	close() {
		const { view } = get();

		if (view?.kind === 'conversation')
			set((state) => {
				const { [view.conversationId]: _closed, ...kept } = state.kept;

				return { kept };
			});

		set({ view: null });
	}
}));
