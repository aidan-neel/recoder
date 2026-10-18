import { create } from 'zustand';

/** The layer an editor writes: `global`, or `repo:<id>` for a repository's `.recoder/REVIEW.md`. */
export type ScopeKey = 'global' | `repo:${string}`;

/** One editor's text. It outlives the editor being closed, so a closing editor keeps its words while it folds away. */
interface Session {
	/** Counts openings, so each opening mounts a fresh editor (idle buttons, no stale draft). */
	opened: number;
	text: string;
	/** The text it opened with; any difference is unsaved. */
	original: string;
	/** The text a landed draft replaced, for Undo draft. Cleared by the next keystroke. */
	beforeDraft: string | null;
}

interface EditorStore {
	/** The open editor, or null. One at a time. */
	open: ScopeKey | null;
	sessions: Partial<Record<ScopeKey, Session>>;
	/** An action waiting on "Discard your changes?", or null. */
	confirm: (() => void) | null;
	/** Opens an editor on fresh text. */
	start: (key: ScopeKey, seed: string) => void;
	edit: (key: ScopeKey, text: string) => void;
	/** Puts a finished draft in the editor and keeps the text it replaced. */
	landDraft: (key: ScopeKey, text: string) => void;
	undoDraft: (key: ScopeKey) => void;
	close: () => void;
	/** Runs an action that would drop the open editor's text: at once when nothing is unsaved, else after a confirm. */
	guard: (action: () => void) => void;
	settleConfirm: (run: boolean) => void;
}

/** True when the open editor holds text that was never saved. */
function hasUnsaved(state: Pick<EditorStore, 'open' | 'sessions'>): boolean {
	const session = state.open ? state.sessions[state.open] : undefined;

	return !!session && session.text !== session.original;
}

/** The guidelines editors on Settings → Guidelines. Module state, so an open editor survives a visit to another section. */
export const useGuidelinesEditor = create<EditorStore>((set, get) => {
	let openings = 0;

	function update(key: ScopeKey, change: Partial<Session>): void {
		const session = get().sessions[key];

		if (session) set({ sessions: { ...get().sessions, [key]: { ...session, ...change } } });
	}

	return {
		open: null,
		sessions: {},
		confirm: null,

		start(key, seed) {
			openings += 1;

			const session = { opened: openings, text: seed, original: seed, beforeDraft: null };

			set({ open: key, sessions: { ...get().sessions, [key]: session } });
		},

		edit(key, text) {
			update(key, { text, beforeDraft: null });
		},

		landDraft(key, text) {
			const session = get().sessions[key];

			if (session) update(key, { text, beforeDraft: session.text });
		},

		undoDraft(key) {
			const before = get().sessions[key]?.beforeDraft;

			if (before !== null && before !== undefined) update(key, { text: before, beforeDraft: null });
		},

		close() {
			set({ open: null });
		},

		guard(action) {
			if (hasUnsaved(get())) set({ confirm: action });
			else action();
		},

		settleConfirm(run) {
			const action = get().confirm;

			set({ confirm: null });

			if (run) action?.();
		}
	};
});

/** Opens the editor for a layer on `seed`, asking first when another editor holds unsaved text. */
export function editLayer(key: ScopeKey, seed: string): void {
	const editor = useGuidelinesEditor.getState();

	editor.guard(() => editor.start(key, seed));
}
