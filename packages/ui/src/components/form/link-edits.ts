import type { TextRange } from './link-find';
import {
	backwardRange,
	embedLinks,
	fitInsert,
	forwardRange,
	linkAfter,
	linkAround,
	linkBefore,
	replaceRange,
	snapRange,
	wordAround,
	type LinkDoc
} from './link-model';

/** A selection as offsets into the text: where it started and where it ends now. */
export interface TextSelection {
	anchor: number;
	focus: number;
}

/** An edit's result: the new content and where the caret lands. */
interface EditResult {
	doc: LinkDoc;
	caret: number;
}

/** Which way and how far a deletion goes: a character, a word, a line, or a range the browser worked out. */
type DeleteKind =
	'backward' | 'forward' | 'word-backward' | 'word-forward' | 'line-backward' | 'line-forward' | 'range';

/** The kind of deletion an input event asks for. */
export function deleteKind(inputType: string): DeleteKind {
	if (inputType === 'deleteContentBackward' || inputType === 'deleteContent') return 'backward';
	if (inputType === 'deleteContentForward') return 'forward';
	if (inputType === 'deleteWordBackward') return 'word-backward';
	if (inputType === 'deleteWordForward') return 'word-forward';
	if (inputType === 'deleteSoftLineBackward' || inputType === 'deleteHardLineBackward') return 'line-backward';
	if (inputType === 'deleteSoftLineForward' || inputType === 'deleteHardLineForward') return 'line-forward';

	return 'range';
}

/** The plain text an `InputEvent` carries: `dataTransfer` when it holds plain text, else `data`. */
export function inputData(event: Pick<InputEvent, 'data' | 'dataTransfer'>): string {
	return event.dataTransfer?.getData('text/plain') || event.data || '';
}

/** What a paste, a drop or a value from outside becomes: plain text with Windows and old Mac line ends made `\n`. */
export function plainText(text: string): string {
	return text.replace(/\r\n?/g, '\n');
}

/** A selection as a range, start first. */
export function rangeOf({ anchor, focus }: TextSelection): TextRange {
	return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
}

/** Whether a selection is a caret past the start of the word it sits in: Home or a click before the word counts as leaving it. */
export function isInsideWord(doc: LinkDoc, selection: TextSelection): boolean {
	const word = wordAround(doc.text, selection.focus);

	return selection.anchor === selection.focus && word.start < selection.focus && selection.focus <= word.end;
}

/** The editor action a key chord asks for: undo, redo, or stepping Left/Right over an embed. */
export function keyAction(
	event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>
): 'undo' | 'redo' | -1 | 1 | null {
	const mod = event.ctrlKey || event.metaKey;
	const key = event.key.toLowerCase();

	if (mod && !event.altKey && key === 'z') return event.shiftKey ? 'redo' : 'undo';
	if (mod && !event.altKey && key === 'y') return 'redo';
	if (!mod && !event.altKey && event.key === 'ArrowLeft') return -1;
	if (!mod && !event.altKey && event.key === 'ArrowRight') return 1;

	return null;
}

/**
 * Typed text at a range, under the length limit. `embedded` is true when the
 * typing ended a link (a space, a line break after it) and it became an
 * embed; the word the caret is in stays text. Null when nothing changes.
 */
export function typeText(
	doc: LinkDoc,
	range: TextRange,
	text: string,
	maxLength: number | undefined
): (EditResult & { embedded: boolean }) | null {
	const snapped = snapRange(doc, range);
	const fitted = fitInsert(doc, snapped, text, maxLength);

	if (fitted === '' && snapped.start === snapped.end) return null;

	const caret = snapped.start + fitted.length;
	const typed = replaceRange(doc, snapped, fitted);
	const embedded = embedLinks(typed, wordAround(typed.text, caret));

	return { doc: embedded, caret, embedded: embedded !== typed };
}

/** Pasted or dropped text at a range: plain text only, under the length limit, and every link in the field an embed. */
export function pasteText(doc: LinkDoc, range: TextRange, raw: string, maxLength: number | undefined): EditResult {
	const snapped = snapRange(doc, range);
	const text = fitInsert(doc, snapped, plainText(raw), maxLength);

	return { doc: embedLinks(replaceRange(doc, snapped, text), null), caret: snapped.start + text.length };
}

/**
 * What a deletion removes. A selection goes as it is, grown to whole embeds.
 * A character or word deletion right beside an embed takes that embed whole;
 * otherwise a non-empty browser target (`target`, which knows grapheme
 * clusters, words and lines) is grown to whole embeds, and a collapsed target
 * falls back to one character or embed in that direction.
 */
export function deletionRange(doc: LinkDoc, kind: DeleteKind, selection: TextRange, target: TextRange): TextRange {
	if (selection.start !== selection.end) return snapRange(doc, selection);

	const caret = selection.start;

	if (kind === 'range') return snapRange(doc, target);

	const backward = kind === 'backward' || kind === 'word-backward' || kind === 'line-backward';
	const takesBeside = kind !== 'line-backward' && kind !== 'line-forward';
	const beside = backward ? linkBefore(doc, caret) : linkAfter(doc, caret);

	if (takesBeside && beside) return beside;
	if (target.start !== target.end) return snapRange(doc, target);

	return backward ? backwardRange(doc, caret) : forwardRange(doc, caret);
}

/** A selection with neither end inside an embed: a caret goes to the nearer edge, a range grows to hold it whole. */
export function snapSelection(doc: LinkDoc, selection: TextSelection): TextSelection {
	if (selection.anchor === selection.focus) {
		const link = linkAround(doc, selection.focus);

		if (!link) return selection;

		const edge = selection.focus - link.start < link.end - selection.focus ? link.start : link.end;

		return { anchor: edge, focus: edge };
	}

	const range = snapRange(doc, rangeOf(selection));

	return selection.anchor <= selection.focus
		? { anchor: range.start, focus: range.end }
		: { anchor: range.end, focus: range.start };
}

/** Left or Right from a caret with an embed next: the caret jumps over it whole. Null otherwise, so the browser moves as usual. */
export function stepOver(doc: LinkDoc, selection: TextSelection, direction: -1 | 1): TextSelection | null {
	if (selection.anchor !== selection.focus) return null;

	const focus = edgePast(doc, selection.focus, direction);

	return focus === null ? null : { anchor: focus, focus };
}

/** Shift+Left or Shift+Right with an embed next to the selection's moving end: that end jumps over it whole. Null otherwise. */
export function extendOver(doc: LinkDoc, selection: TextSelection, direction: -1 | 1): TextSelection | null {
	const focus = edgePast(doc, selection.focus, direction);

	return focus === null ? null : { anchor: selection.anchor, focus };
}

/** The far edge of the embed next to an offset in one direction, or null when no embed is there. */
function edgePast(doc: LinkDoc, offset: number, direction: -1 | 1): number | null {
	if (direction === -1) return linkBefore(doc, offset)?.start ?? null;

	return linkAfter(doc, offset)?.end ?? null;
}
