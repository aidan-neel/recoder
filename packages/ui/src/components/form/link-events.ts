import { offsetAtPoint, rangeOffsets } from './link-dom';
import { inputData } from './link-edits';
import type { TextRange } from './link-find';

/** What the DOM event wiring asks of `LinkEditor` when browser events arrive on its element. */
export interface EditorEventTarget {
	editable: () => boolean;
	composing: () => boolean;
	selectionRange: () => TextRange;
	insert: (range: TextRange, text: string) => void;
	paste: (range: TextRange, raw: string) => void;
	remove: (inputType: string, target: TextRange) => void;
	undo: () => void;
	redo: () => void;
	selectedText: (range: TextRange) => string;
	cutRange: (range: TextRange) => void;
	holdBeforeInput: () => void;
	adoptInput: () => void;
	startComposition: () => void;
	endComposition: () => void;
	focusFromKeyboard: () => void;
	blur: () => void;
	selectionChange: () => void;
}

/**
 * Binds the DOM events a `LinkEditor` owns on `root` and its document, and
 * returns the cleanup function that removes every listener at once.
 */
export function attachEditorEvents(root: HTMLElement, editor: EditorEventTarget): () => void {
	const page = root.ownerDocument;
	const stop = new AbortController();
	const options = { signal: stop.signal };
	let pointing = false;

	root.addEventListener('beforeinput', (event) => onBeforeInput(root, editor, event), options);
	root.addEventListener('input', () => editor.adoptInput(), options);
	root.addEventListener('paste', (event) => onPaste(editor, event), options);
	root.addEventListener('copy', (event) => onCopy(editor, event), options);
	root.addEventListener('cut', (event) => onCut(editor, event), options);
	root.addEventListener('drop', (event) => onDrop(root, editor, event), options);
	root.addEventListener('dragstart', (event) => event.preventDefault(), options);
	root.addEventListener('compositionstart', () => editor.startComposition(), options);
	root.addEventListener('compositionend', () => editor.endComposition(), options);
	root.addEventListener('focus', () => (pointing ? undefined : editor.focusFromKeyboard()), options);
	root.addEventListener('blur', () => editor.blur(), options);

	root.addEventListener(
		'pointerdown',
		() => {
			pointing = true;
		},
		options
	);

	page.addEventListener(
		'pointerup',
		() => {
			pointing = false;
		},
		options
	);

	page.addEventListener('selectionchange', () => editor.selectionChange(), options);

	return () => stop.abort();
}

/** The range the browser says an `InputEvent` would replace, or the current selection when it gives none. */
function eventTargetRange(root: HTMLElement, editor: EditorEventTarget, event: InputEvent): TextRange {
	const [target] = event.getTargetRanges();

	return target ? rangeOffsets(root, target) : editor.selectionRange();
}

/** Cancels and applies owned `beforeinput` types; lets unhandled types pass through for `input` to adopt. */
function onBeforeInput(root: HTMLElement, editor: EditorEventTarget, event: InputEvent): void {
	if (!editor.editable()) {
		event.preventDefault();

		return;
	}

	if (editor.composing() || event.isComposing || event.inputType === 'insertCompositionText') return;

	if (!dispatchInputType(root, editor, event)) editor.holdBeforeInput();
}

/** Applies one owned `beforeinput` event and cancels the browser's default; returns false when unhandled. */
function dispatchInputType(root: HTMLElement, editor: EditorEventTarget, event: InputEvent): boolean {
	const type = event.inputType;

	if (type === 'historyUndo' || type === 'historyRedo') {
		event.preventDefault();

		if (type === 'historyUndo') editor.undo();
		else editor.redo();

		return true;
	}

	if (type === 'insertText') {
		event.preventDefault();
		editor.insert(eventTargetRange(root, editor, event), inputData(event));

		return true;
	}

	if (type === 'insertLineBreak' || type === 'insertParagraph') {
		event.preventDefault();
		editor.insert(eventTargetRange(root, editor, event), '\n');

		return true;
	}

	if (type.startsWith('insertFrom') || type === 'insertReplacementText') {
		event.preventDefault();
		editor.paste(eventTargetRange(root, editor, event), inputData(event));

		return true;
	}

	if (type.startsWith('delete')) {
		event.preventDefault();
		editor.remove(type, eventTargetRange(root, editor, event));

		return true;
	}

	return false;
}

/** Pastes plain text into an editable field; cancels paste on a disabled field too. */
function onPaste(editor: EditorEventTarget, event: ClipboardEvent): void {
	event.preventDefault();

	if (!editor.editable()) return;

	editor.paste(editor.selectionRange(), event.clipboardData?.getData('text/plain') ?? '');
}

/** Writes a non-empty selection's model text to `event.clipboardData`, returning the range written. */
function writeSelectedToClipboard(editor: EditorEventTarget, event: ClipboardEvent): TextRange | null {
	if (!event.clipboardData) return null;

	const range = editor.selectionRange();

	if (range.start === range.end) return null;

	event.preventDefault();
	event.clipboardData.setData('text/plain', editor.selectedText(range));

	return range;
}

/** Copies the selected model text (with full URLs) even when the field is read-only. */
function onCopy(editor: EditorEventTarget, event: ClipboardEvent): void {
	writeSelectedToClipboard(editor, event);
}

/** Cuts the selected model text when editable; does nothing when disabled. */
function onCut(editor: EditorEventTarget, event: ClipboardEvent): void {
	if (!editor.editable()) {
		event.preventDefault();

		return;
	}

	const range = writeSelectedToClipboard(editor, event);

	if (range) editor.cutRange(range);
}

/** Inserts dropped plain text at the drop point when editable. */
function onDrop(root: HTMLElement, editor: EditorEventTarget, event: DragEvent): void {
	event.preventDefault();

	if (!editor.editable()) return;

	const text = event.dataTransfer?.getData('text/plain') ?? '';
	const at = offsetAtPoint(root, event.clientX, event.clientY);

	if (text && at !== null) editor.paste({ start: at, end: at }, text);
}
