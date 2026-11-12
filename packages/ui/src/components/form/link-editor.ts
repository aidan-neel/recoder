import {
	embedAt,
	markSelected,
	embedRange,
	offsetAtPoint,
	rangeOffsets,
	readDoc,
	readSelection,
	renderDoc,
	scrollToCaret,
	writeSelection,
	type EmbedLook
} from './link-dom';
import {
	deleteKind,
	deletionRange,
	extendOver,
	pasteText,
	plainText,
	rangeOf,
	snapSelection,
	stepOver,
	typeText,
	type TextSelection
} from './link-edits';
import type { TextRange } from './link-find';
import { EMPTY_HISTORY, record, redo, undo, type EditKind, type History, type Snapshot } from './link-history';
import { docFromText, embedLinks, linkAfter, linkBefore, replaceRange, wordAround, type LinkDoc } from './link-model';

/** What the editor asks of its host, read fresh on every use so a prop change needs no new editor. */
export interface EditorHost {
	look: (url: string) => EmbedLook;
	maxLength: () => number | undefined;
	/** The person changed the text. */
	onChange: (text: string) => void;
	/** The caret moved, or an edit landed: the host re-reads `embedBesideCaret` and `editedLast`. */
	onCaret: () => void;
}

/**
 * The link field's behaviour, on an editable element it does not create.
 * The text and its embeds live in a model (`LinkDoc`); the element is a view
 * of it. Every edit the browser would make is cancelled and made on the model
 * instead, then drawn, so the model and the screen never disagree. The one
 * exception is an IME composition, which the browser writes itself; the
 * editor reads the result back when the composition ends. Undo and redo use
 * the editor's own history, since cancelled edits leave the browser's empty.
 */
export class LinkEditor {
	private doc: LinkDoc;
	private history: History = EMPTY_HISTORY;
	/** The last edit typed at the caret, so the word around it stays text until it ends. */
	private typing = false;
	/** A link that just became an embed because a character ended it, and what the text was before that. */
	private conversion: { caret: number; before: Snapshot } | null = null;
	/** Where the last edit left the caret, while it is still there: a card beside it stays shut. */
	private editedAt: number | null = null;
	private composing = false;
	private pointing = false;

	constructor(
		private readonly root: HTMLElement,
		value: string,
		private readonly host: EditorHost
	) {
		this.doc = docFromText(plainText(value));
		this.draw();
	}

	/** The text the field holds. */
	get text(): string {
		return this.doc.text;
	}

	/** True while the caret is where the last edit left it, so a card beside it stays shut. */
	get editedLast(): boolean {
		return this.editedAt !== null;
	}

	/** Takes focus with the caret at the end of the text. */
	focusAtEnd(): void {
		this.root.focus({ preventScroll: true });
		this.place(this.doc.text.length);
	}

	/** Listens to the element and the document; returns the function that stops listening. */
	attach(): () => void {
		const root = this.root;
		const page = root.ownerDocument;
		const stop = new AbortController();
		const options = { signal: stop.signal };

		root.addEventListener('beforeinput', this.onBeforeInput, options);
		root.addEventListener('input', this.onInput, options);
		root.addEventListener('paste', this.onPaste, options);
		root.addEventListener('copy', this.onCopy, options);
		root.addEventListener('cut', this.onCut, options);
		root.addEventListener('drop', this.onDrop, options);
		root.addEventListener('dragstart', this.onDragStart, options);
		root.addEventListener('compositionstart', this.onCompositionStart, options);
		root.addEventListener('compositionend', this.onCompositionEnd, options);
		root.addEventListener('focus', this.onFocus, options);
		root.addEventListener('blur', this.onBlur, options);
		root.addEventListener('pointerdown', this.onPointerDown, options);
		page.addEventListener('pointerup', this.onPointerUp, options);
		page.addEventListener('selectionchange', this.onSelectionChange, options);

		return () => stop.abort();
	}

	/**
	 * Takes a value from outside (cleared after send, filled by a suggestion).
	 * Every link in it is an embed; the caret goes to the end when the field
	 * has focus. Nothing happens when the value is what the field holds.
	 */
	setValue(value: string): void {
		const text = plainText(value);

		if (text === this.doc.text || this.composing) return;

		this.history = record(this.history, this.snapshot(), 'other', text.length, Date.now());
		this.typing = false;
		this.conversion = null;
		this.doc = docFromText(text);
		this.draw();

		if (this.focused()) this.place(text.length);
	}

	/** Draws the embeds again, after the host's facts about them changed. */
	refresh(): void {
		const selection = this.focused() ? readSelection(this.root) : null;

		this.draw();

		if (selection) writeSelection(this.root, selection);
	}

	/**
	 * The keys the editor owns: undo and redo, and Left and Right (with Shift)
	 * stepping over an embed as one character. Call it after the host's own
	 * handler, and only when that one did not prevent the key.
	 */
	keyDown(event: KeyboardEvent): void {
		if (this.composing || event.isComposing) return;

		const mod = event.ctrlKey || event.metaKey;
		const key = event.key.toLowerCase();

		if (mod && !event.altKey && key === 'z') {
			event.preventDefault();

			if (event.shiftKey) this.redo();
			else this.undo();

			return;
		}

		if (mod && !event.altKey && key === 'y') {
			event.preventDefault();
			this.redo();

			return;
		}

		if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !mod && !event.altKey) {
			this.step(event, event.key === 'ArrowLeft' ? -1 : 1);
		}
	}

	/** The embed the caret sits right after (else right before), with its range; null with a selection. */
	embedBesideCaret(): { element: HTMLElement; range: TextRange } | null {
		const selection = this.focused() ? readSelection(this.root) : null;

		if (!selection || selection.anchor !== selection.focus) return null;

		const range = linkBefore(this.doc, selection.focus) ?? linkAfter(this.doc, selection.focus);
		const element = range ? embedAt(this.root, range) : null;

		return range && element ? { element, range } : null;
	}

	/** Puts a caret at the edge of an embed nearer to where it was pressed. */
	placeBeside(embed: HTMLElement, clientX: number): void {
		const box = embed.getBoundingClientRect();
		const range = embedRange(this.root, embed);

		if (!range) return;

		if (!this.focused()) this.root.focus({ preventScroll: true });

		this.place(clientX < box.left + box.width / 2 ? range.start : range.end);
		this.typing = false;
		this.editedAt = null;
		this.host.onCaret();
	}

	/** Selects a whole embed, as a double click on a word selects the word. */
	selectEmbed(embed: HTMLElement): void {
		const range = embedRange(this.root, embed);

		if (range) writeSelection(this.root, { anchor: range.start, focus: range.end });
	}

	private readonly onBeforeInput = (event: InputEvent): void => {
		if (this.composing || event.isComposing || event.inputType === 'insertCompositionText') return;

		event.preventDefault();

		const type = event.inputType;
		const data = event.dataTransfer?.getData('text/plain') ?? event.data ?? '';

		if (type === 'historyUndo') this.undo();
		else if (type === 'historyRedo') this.redo();
		else if (type === 'insertText') this.insert(this.selectionRange(), data, 'type');
		else if (type === 'insertLineBreak' || type === 'insertParagraph') this.insert(this.selectionRange(), '\n', 'type');
		else if (type.startsWith('insertFrom') || type === 'insertReplacementText')
			this.paste(this.targetRange(event), data);
		else if (type.startsWith('delete')) this.remove(event);
	};

	/** An edit that slipped past `beforeinput` (a browser that does not send it): the DOM is read back as the truth. */
	private readonly onInput = (): void => {
		if (!this.composing) this.adoptDom();
	};

	private readonly onPaste = (event: ClipboardEvent): void => {
		event.preventDefault();
		this.paste(this.selectionRange(), event.clipboardData?.getData('text/plain') ?? '');
	};

	private readonly onCopy = (event: ClipboardEvent): void => {
		const range = this.selectionRange();

		if (range.start === range.end || !event.clipboardData) return;

		event.preventDefault();
		event.clipboardData.setData('text/plain', this.doc.text.slice(range.start, range.end));
	};

	private readonly onCut = (event: ClipboardEvent): void => {
		const range = this.selectionRange();

		this.onCopy(event);

		if (range.start !== range.end) this.edit(replaceRange(this.doc, range, ''), range.start, 'other');
	};

	/** A drop inserts the dragged text, as plain text, where it lands. */
	private readonly onDrop = (event: DragEvent): void => {
		event.preventDefault();

		const text = event.dataTransfer?.getData('text/plain') ?? '';
		const at = offsetAtPoint(this.root, event.clientX, event.clientY);

		if (text && at !== null) this.paste({ start: at, end: at }, text);
	};

	/** Text is not dragged out of the field: a move would be an edit the model cannot see whole. */
	private readonly onDragStart = (event: DragEvent): void => event.preventDefault();

	private readonly onCompositionStart = (): void => {
		this.composing = true;
	};

	private readonly onCompositionEnd = (): void => {
		this.composing = false;
		this.adoptDom();
	};

	private readonly onFocus = (): void => {
		if (!this.pointing) this.place(this.doc.text.length);
	};

	/** Leaving the field ends the word being typed: a link in it becomes an embed. */
	private readonly onBlur = (): void => {
		markSelected(this.root, null);
		this.typing = false;
		this.conversion = null;
		this.commit(null);
		this.host.onCaret();
	};

	private readonly onPointerDown = (): void => {
		this.pointing = true;
	};

	private readonly onPointerUp = (): void => {
		this.pointing = false;
	};

	/**
	 * Keeps the caret out of embeds and turns a typed link into an embed once
	 * the caret leaves its word.
	 */
	private readonly onSelectionChange = (): void => {
		if (this.composing) return;

		const selection = readSelection(this.root);

		if (!selection) return;

		const snapped = snapSelection(this.doc, selection);

		if (snapped.anchor !== selection.anchor || snapped.focus !== selection.focus) writeSelection(this.root, snapped);

		if (this.conversion && this.conversion.caret !== snapped.focus) this.conversion = null;
		if (this.editedAt !== snapped.focus || snapped.anchor !== snapped.focus) this.editedAt = null;

		if (this.typing && !this.isInsideWord(snapped)) this.typing = false;

		this.commit(snapped.anchor === snapped.focus ? snapped.focus : null);
		markSelected(this.root, rangeOf(snapped));
		this.host.onCaret();
	};

	/** Whether a selection is a caret past the start of the word it sits in: Home or a click before the word counts as leaving it. */
	private isInsideWord(selection: TextSelection): boolean {
		const word = wordAround(this.doc.text, selection.focus);

		return selection.anchor === selection.focus && word.start < selection.focus && selection.focus <= word.end;
	}

	/** Types text at a range. A link the typing ends (a space, a line break) becomes an embed in a step of its own. */
	private insert(range: TextRange, text: string, kind: EditKind): void {
		const typed = typeText(this.doc, range, text, this.host.maxLength());

		if (!typed) return;

		if (!typed.embedded) {
			this.edit(typed.doc, typed.caret, kind);
			this.typing = true;

			return;
		}

		const before = this.snapshot();

		this.edit(typed.doc, typed.caret, 'other');
		this.conversion = { caret: typed.caret, before };
	}

	/** Pasted or dropped text: plain text only, and every link in it an embed at once. */
	private paste(range: TextRange, raw: string): void {
		const pasted = pasteText(this.doc, range, raw, this.host.maxLength());

		this.edit(pasted.doc, pasted.caret, 'other');
	}

	/**
	 * A deletion. An embed goes whole. Backspace right after a link became an
	 * embed because a character ended it takes that character back and turns
	 * the embed back into text, so a typo in it can still be fixed.
	 */
	private remove(event: InputEvent): void {
		const selection = this.selectionRange();
		const kind = deleteKind(event.inputType);
		const caret = selection.start === selection.end ? selection.start : null;

		if (kind === 'backward' && this.conversion && caret === this.conversion.caret) {
			const { before } = this.conversion;

			this.edit(before.doc, before.caret, 'other');
			this.typing = true;

			return;
		}

		const range = deletionRange(this.doc, kind, selection, this.targetRange(event));

		if (range.start !== range.end) this.edit(replaceRange(this.doc, range, ''), range.start, 'delete');
	}

	/** Records an edit, draws it, puts the caret, and tells the host. */
	private edit(next: LinkDoc, caret: number, kind: EditKind): void {
		const changed = next.text !== this.doc.text;

		this.history = record(this.history, this.snapshot(), kind, caret, Date.now());
		this.typing = false;
		this.conversion = null;
		this.show({ doc: next, caret });

		if (changed) this.host.onChange(next.text);
	}

	private undo(): void {
		const step = undo(this.history, this.snapshot());

		if (step) this.travel(step.history, step.snapshot);
	}

	private redo(): void {
		const step = redo(this.history, this.snapshot());

		if (step) this.travel(step.history, step.snapshot);
	}

	/** Shows a state from the history; the text it holds goes to the host. */
	private travel(history: History, snapshot: Snapshot): void {
		const changed = snapshot.doc.text !== this.doc.text;

		this.history = history;
		this.typing = false;
		this.conversion = null;
		this.show(snapshot);

		if (changed) this.host.onChange(snapshot.doc.text);
	}

	/** Makes the model what the DOM shows: after a composition, or an edit the browser made without asking. */
	private adoptDom(): void {
		const read = readDoc(this.root);
		const selection = readSelection(this.root);

		if (read.text === this.doc.text && read.links.length === this.doc.links.length) return;

		const caret = selection?.focus ?? read.text.length;

		this.history = record(this.history, this.snapshot(), 'type', caret, Date.now());
		this.typing = true;
		this.show({ doc: embedLinks(read, wordAround(read.text, caret)), caret });
		this.host.onChange(read.text);
	}

	/** Turns links outside the word at `caret` into embeds (all of them when `caret` is null). */
	private commit(caret: number | null): void {
		const keep = caret !== null && this.typing ? wordAround(this.doc.text, caret) : null;
		const next = embedLinks(this.doc, keep);

		if (next === this.doc) return;

		const selection = this.focused() ? readSelection(this.root) : null;

		this.doc = next;
		this.draw();

		if (selection) writeSelection(this.root, selection);
	}

	/** Left or Right next to an embed jumps over it; with Shift the selection grows over it whole. */
	private step(event: KeyboardEvent, direction: -1 | 1): void {
		const selection = readSelection(this.root);
		const move = event.shiftKey ? extendOver : stepOver;
		const next = selection ? move(this.doc, selection, direction) : null;

		if (!next) return;

		event.preventDefault();
		writeSelection(this.root, next);
		this.typing = false;
	}

	private draw(): void {
		renderDoc(this.root, this.doc, this.host.look);
		this.root.toggleAttribute('data-empty', this.doc.text === '');
	}

	/** Shows a state: draws it, puts the caret and keeps the caret in view. */
	private show({ doc, caret }: Snapshot): void {
		this.doc = doc;
		this.editedAt = caret;
		this.draw();
		this.place(caret);
		this.host.onCaret();
	}

	/** Puts a caret at a text offset and scrolls the field so it shows. */
	private place(caret: number): void {
		if (!this.focused()) return;

		writeSelection(this.root, { anchor: caret, focus: caret });
		scrollToCaret(this.root);
	}

	private snapshot(): Snapshot {
		const selection = readSelection(this.root);

		return { doc: this.doc, caret: selection?.focus ?? this.doc.text.length };
	}

	private selectionRange(): TextRange {
		const selection = readSelection(this.root);

		return selection ? rangeOf(selection) : { start: this.doc.text.length, end: this.doc.text.length };
	}

	/** The range the browser says an input event would change, as text offsets; the selection when it says none. */
	private targetRange(event: InputEvent): TextRange {
		const [target] = event.getTargetRanges();

		return target ? rangeOffsets(this.root, target) : this.selectionRange();
	}

	private focused(): boolean {
		return this.root.ownerDocument.activeElement === this.root;
	}
}
