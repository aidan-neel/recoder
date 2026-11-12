'use client';

import { Button, DURATION, Keycap, Textarea } from '@recoder/ui';
import { Undo2 } from 'lucide-react';
import { useEffect, useRef, type RefObject } from 'react';

import { caretAt, firstRule } from '@/lib/guidelines/rules';
import { useGuidelinesEdit, type GuidelinesEditorSpec } from '@/lib/guidelines/use-editor';

import { DraftPopover } from './draft-popover';
import { EditorNote } from './editor-note';
import { StreamView } from './stream-view';

/** The rows the text field opens with, and the rows it grows to before it scrolls. */
const MIN_ROWS = 12;
const MAX_ROWS = 24;

/** The unfold, then a moment for the layout to settle, before the layer is brought into view. */
const REVEAL_AFTER_MS = DURATION.disclose * 1000 + 60;

/** How the page scrolls to the opened editor: at once for a reader who asked for less motion. */
function revealBehavior(): ScrollBehavior {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

/**
 * Focuses the text field when the editor opens, with the caret where typing
 * belongs (see `caretAt`): a caret at the end scrolls a long file to its last
 * lines. Once the editor has unfolded, the whole layer is brought into view.
 */
function useFocusOnOpen(open: boolean): RefObject<HTMLTextAreaElement | null> {
	const field = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		const node = field.current;

		if (!open || !node) return;

		const caret = caretAt(node.value);

		node.focus({ preventScroll: true });
		node.setSelectionRange(caret, caret);
		node.scrollTop = caret === node.value.length ? node.scrollHeight : 0;

		const timer = setTimeout(
			() => node.closest('.guidelines-item')?.scrollIntoView({ block: 'nearest', behavior: revealBehavior() }),
			REVEAL_AFTER_MS
		);

		return () => clearTimeout(timer);
	}, [open]);

	return field;
}

/**
 * The editor for one layer of guidelines, unfolded under its row: the
 * Markdown in a mono field, a note and the character count, then a bar with
 * Draft with AI on the left and Cancel and Save (or Open pull request) on the
 * right. ⌘↵ saves and Esc cancels.
 */
export function GuidelinesEditor(spec: GuidelinesEditorSpec) {
	const field = useFocusOnOpen(spec.open);
	const edit = useGuidelinesEdit({ ...spec, field });

	return (
		<div className="guidelines-editor" onKeyDown={edit.onKeyDown}>
			{edit.streaming ? (
				<StreamView text={edit.streamed} minHeight={edit.streamMinHeight} />
			) : (
				<Textarea
					ref={field}
					autosize
					minRows={MIN_ROWS}
					maxRows={MAX_ROWS}
					value={edit.text}
					readOnly={edit.pending}
					invalid={edit.over}
					spellCheck
					aria-label={`${spec.label} (Markdown)`}
					className="guidelines-field thin-scroll"
					onChange={(event) => edit.edit(event.target.value)}
				/>
			)}
			<EditorNote note={edit.note} length={edit.shownLength} max={spec.maxChars} />
			<div className="guidelines-bar">
				<DraftPopover
					repoId={spec.repo ? spec.repo.repoId : null}
					revising={firstRule(edit.text) !== null}
					streaming={edit.streaming}
					disabled={edit.pending}
					onDraft={edit.startDraft}
					onStop={edit.stopDraft}
				/>
				{edit.canUndoDraft ? (
					<Button variant="quiet" className="guidelines-quiet" onClick={edit.undoDraft}>
						<Undo2 aria-hidden />
						Undo draft
					</Button>
				) : null}
				<div className="guidelines-bar-end">
					<Button variant="ghost" disabled={edit.pending} onClick={edit.cancel}>
						Cancel
					</Button>
					<Button
						variant="primary"
						status={edit.status}
						successLabel={edit.successLabel}
						disabled={!edit.canSave && edit.status === 'idle'}
						aria-keyshortcuts="Meta+Enter Control+Enter"
						onClick={edit.save}
					>
						{edit.saveLabel}
						<Keycap k="mod+Enter" />
					</Button>
				</div>
			</div>
		</div>
	);
}
