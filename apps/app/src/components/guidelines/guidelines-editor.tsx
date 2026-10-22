'use client';

import type { GuidelinesDraftRequest, RepoGuidelines } from '@recoder/shared';
import { Button, Keycap, Textarea, Tooltip } from '@recoder/ui';
import { Undo2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { useGuidelinesEditor, type ScopeKey } from '@/lib/guidelines/editor-store';
import { caretAt, firstRule, trimEmptyBullets } from '@/lib/guidelines/rules';

import { DraftPopover } from './draft-popover';
import { EditorNote } from './editor-note';
import { StreamView } from './stream-view';
import { useDraft } from './use-draft';
import { useSave } from './use-save';

interface GuidelinesEditorProps {
	scope: ScopeKey;
	open: boolean;
	/** The repository file being edited, or null for the global layer. */
	repo: RepoGuidelines | null;
	maxChars: number;
	/** Names the text field: "Global guidelines", "acme/api guidelines". */
	label: string;
}

/** The global layer saves in place; a repository's file goes through a pull request. */
function saveLabel(repo: RepoGuidelines | null): string {
	if (!repo) return 'Save';

	return repo.pending ? 'Update pull request' : 'Open pull request';
}

/** The check face after the save landed, in the same words. */
function successLabel(repo: RepoGuidelines | null): string {
	if (!repo) return 'Saved';

	return repo.pending ? 'Updated' : 'Opened';
}

/**
 * Focuses the text field when the editor opens, with the caret where typing
 * belongs (see `caretAt`) and in view: a caret at the end scrolls a long file
 * to its last lines. Then it brings the whole editor into view once it has
 * unfolded.
 */
function useFocusOnOpen(open: boolean) {
	const field = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		const node = field.current;

		if (!open || !node) return;

		const caret = caretAt(node.value);

		node.focus({ preventScroll: true });
		node.setSelectionRange(caret, caret);
		node.scrollTop = caret === node.value.length ? node.scrollHeight : 0;

		const timer = setTimeout(
			() =>
				field.current?.closest('[data-ui="guidelines-row"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
			260
		);

		return () => clearTimeout(timer);
	}, [open]);

	return field;
}

/** Asks before the page unloads while the editor holds unsaved text. */
function useUnloadGuard(dirty: boolean) {
	useEffect(() => {
		if (!dirty) return;

		function hold(event: BeforeUnloadEvent): void {
			event.preventDefault();
		}

		window.addEventListener('beforeunload', hold);

		return () => window.removeEventListener('beforeunload', hold);
	}, [dirty]);
}

/**
 * The editor for one layer of guidelines, folded open under its row: the
 * Markdown in a mono field, then a bar with "Draft with Orchestrator" on
 * the left and Cancel and Save (or Open pull request) on the right. ⌘↵
 * saves; Esc cancels. Leaving with unsaved text asks first.
 */
export function GuidelinesEditor({ scope, open, repo, maxChars, label }: GuidelinesEditorProps) {
	const session = useGuidelinesEditor((state) => state.sessions[scope]);
	const text = session?.text ?? '';
	const dirty = open && !!session && session.text !== session.original;
	const draft = useDraft(scope, open);
	const saving = useSave(repo ? repo.repoId : null);
	const field = useFocusOnOpen(open);
	const [streamHeight, setStreamHeight] = useState<number | undefined>(undefined);
	const length = text.trim().length;
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

	/** ⌘↵ saves and Esc cancels, for keys pressed inside the editor (not in its popover, which portals out). */
	function onKey(event: KeyboardEvent<HTMLDivElement>): void {
		if (!event.currentTarget.contains(event.target as Node) || event.nativeEvent.isComposing) return;

		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			save();
		} else if (event.key === 'Escape' && saving.status !== 'pending') {
			event.preventDefault();
			cancel();
		}
	}

	return (
		<div data-ui="guidelines-editor" className="guidelines-editor" onKeyDown={onKey}>
			{draft.streaming ? (
				<StreamView text={draft.streamed} minHeight={streamHeight} />
			) : (
				<Textarea
					ref={field}
					autosize
					minRows={12}
					maxRows={24}
					value={text}
					readOnly={saving.status === 'pending'}
					invalid={over}
					spellCheck
					aria-label={`${label} (Markdown)`}
					className="guidelines-field thin-scroll"
					onChange={(event) => edit(event.target.value)}
				/>
			)}
			<EditorNote
				error={saving.error ?? draft.error}
				length={draft.streaming ? draft.streamed.trim().length : length}
				max={maxChars}
				repo={repo}
			/>
			<div className="guidelines-bar">
				<DraftPopover
					repoId={repo ? repo.repoId : null}
					revising={!!firstRule(text)}
					streaming={draft.streaming}
					disabled={saving.status === 'pending'}
					onDraft={startDraft}
					onStop={draft.stop}
				/>
				{session?.beforeDraft != null && !draft.streaming ? (
					<Tooltip content="Undo draft">
						<Button
							variant="quiet"
							size="icon"
							aria-label="Undo draft"
							className="text-fg-subtle"
							onClick={() => useGuidelinesEditor.getState().undoDraft(scope)}
						>
							<Undo2 />
						</Button>
					</Tooltip>
				) : null}
				<Button variant="ghost" className="ml-auto" disabled={saving.status === 'pending'} onClick={cancel}>
					Cancel
				</Button>
				<Button
					variant="primary"
					status={saving.status}
					successLabel={successLabel(repo)}
					disabled={!canSave && saving.status === 'idle'}
					onClick={save}
				>
					{saveLabel(repo)}
					<Keycap k="mod+Enter" />
				</Button>
			</div>
		</div>
	);
}
