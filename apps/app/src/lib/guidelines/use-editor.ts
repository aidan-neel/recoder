'use client';

import type { GuidelinesDraftRequest, RepoGuidelines } from '@recoder/shared';
import type { ButtonStatus } from '@recoder/ui';
import { useState, type KeyboardEvent, type RefObject } from 'react';

import { editorNote, type EditorNote } from './editor-note';
import { useGuidelinesEditor, type ScopeKey } from './editor-store';
import { firstRule, saveLabel, successLabel, trimEmptyBullets } from './rules';
import { useDraft } from './use-draft';
import { useSave } from './use-save';
import { useUnloadGuard } from './use-unload-guard';

/** What an editor needs to mount: its layer, whether it is open, and the repository file it edits (null for the global layer). */
export interface GuidelinesEditorSpec {
	scope: ScopeKey;
	open: boolean;
	repo: RepoGuidelines | null;
	maxChars: number;
	/** Names the text field for its aria-label, e.g. "Global guidelines" or "acme/api guidelines". */
	label: string;
}

/** `GuidelinesEditorSpec` plus the text field's element, which the stream view measures for its starting height. */
export interface GuidelinesEditOptions extends GuidelinesEditorSpec {
	/** The text field's element; pass the ref the markup puts on the textarea. */
	field: RefObject<HTMLElement | null>;
}

/** Everything the guidelines editor shows and does. */
export interface GuidelinesEdit {
	/** The editor's text; empty until its session opens. */
	text: string;
	/** The text differs from what the editor opened with. */
	dirty: boolean;
	/** A draft is streaming in. */
	streaming: boolean;
	/** The draft so far, without the code fence the model may wrap it in. */
	streamed: string;
	/** The failure the note shows: the save's, else the draft's. */
	error: string | null;
	/** The trimmed length of `text`. */
	length: number;
	/** The count the note judges and the counter shows: the streaming draft's while it streams, else `length`. */
	shownLength: number;
	/** `length` is over `maxChars`. */
	over: boolean;
	/** A repository file can't open a pull request without a write token. */
	blocked: boolean;
	/** Dirty, within the limit, not blocked, and no draft streaming: the save button is live. */
	canSave: boolean;
	/** The save is with the server: the field is read-only and Cancel waits. */
	pending: boolean;
	/** The save button's status face. */
	status: ButtonStatus;
	saveLabel: string;
	successLabel: string;
	/** A landed draft can be undone. */
	canUndoDraft: boolean;
	/** The note line's content, or null when there is none. */
	note: EditorNote | null;
	/** The stream view's starting height: the field's height when the draft began. */
	streamMinHeight: number | undefined;
	edit: (text: string) => void;
	save: () => void;
	cancel: () => void;
	/** Starts a draft; resolves true once it landed in the editor. */
	startDraft: (request: Omit<GuidelinesDraftRequest, 'current' | 'scope'>) => Promise<boolean>;
	stopDraft: () => void;
	undoDraft: () => void;
	/** ⌘↵ saves and Esc cancels, for keys pressed inside the editor (not in its popover, which portals out). */
	onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * The editor for one layer of guidelines: the text, its dirty and limit
 * state, the save's status, the streaming draft and its undo, the note line,
 * and the keys that save and cancel. Leaving with unsaved text asks first.
 */
export function useGuidelinesEdit({ scope, open, repo, maxChars, field }: GuidelinesEditOptions): GuidelinesEdit {
	const session = useGuidelinesEditor((state) => state.sessions[scope]);
	const text = session?.text ?? '';
	const dirty = open && !!session && session.text !== session.original;
	const draft = useDraft(scope, open);
	const saving = useSave(repo ? repo.repoId : null);
	const [streamHeight, setStreamHeight] = useState<number | undefined>(undefined);
	const length = text.trim().length;
	const shownLength = draft.streaming ? draft.streamed.trim().length : length;
	const over = length > maxChars;
	const blocked = !!repo && !repo.canPropose;
	const canSave = dirty && !over && !blocked && !draft.streaming;

	useUnloadGuard(dirty);

	function edit(next: string): void {
		useGuidelinesEditor.getState().edit(scope, next);
		saving.reset();
		draft.clearError();
	}

	function save(): void {
		if (canSave) void saving.save(trimEmptyBullets(text));
	}

	function cancel(): void {
		draft.stop();

		const editor = useGuidelinesEditor.getState();

		editor.guard(editor.close);
	}

	function startDraft(request: Omit<GuidelinesDraftRequest, 'current' | 'scope'>): Promise<boolean> {
		saving.reset();
		setStreamHeight(field.current?.offsetHeight);

		const current = firstRule(text) ? text : undefined;

		return draft.run({ ...request, scope: repo ? 'repo' : 'global', current });
	}

	function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
		if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
		if (event.nativeEvent.isComposing) return;

		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			save();
		} else if (event.key === 'Escape' && saving.status !== 'pending') {
			event.preventDefault();
			cancel();
		}
	}

	return {
		text,
		dirty,
		streaming: draft.streaming,
		streamed: draft.streamed,
		error: saving.error ?? draft.error,
		length,
		shownLength,
		over,
		blocked,
		canSave,
		pending: saving.status === 'pending',
		status: saving.status,
		saveLabel: saveLabel(repo),
		successLabel: successLabel(repo),
		canUndoDraft: session?.beforeDraft != null && !draft.streaming,
		note: editorNote({ error: saving.error ?? draft.error, length: shownLength, max: maxChars, repo }),
		streamMinHeight: streamHeight,
		edit,
		save,
		cancel,
		startDraft,
		stopDraft: draft.stop,
		undoDraft: () => useGuidelinesEditor.getState().undoDraft(scope),
		onKeyDown
	};
}
