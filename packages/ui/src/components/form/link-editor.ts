import {
	adoptEdit,
	deferValue,
	EMPTY_COMPOSITION,
	endComposition,
	holdBeforeInput,
	startComposition,
	takeBeforeInput,
	type Composition
} from './link-composition';
import {
	embedAt,
	embedRange,
	markSelected,
	readDoc,
	readSelection,
	renderDoc,
	scrollToCaret,
	writeSelection,
	type EmbedSource
} from './link-dom';
import {
	deleteKind,
	deletionRange,
	extendOver,
	isInsideWord,
	keyAction,
	pasteText,
	plainText,
	rangeOf,
	snapSelection,
	stepOver,
	typeText
} from './link-edits';
import { attachEditorEvents } from './link-events';
import type { TextRange } from './link-find';
import { EMPTY_HISTORY, record, redo, undo, type EditKind, type History, type Snapshot } from './link-history';
import { withoutImageTokens } from './link-image';
import { docFromText, embedLinks, linkAfter, linkBefore, replaceRange, wordAround, type LinkDoc } from './link-model';

/** What the editor asks of its host, read fresh on every use so a prop change needs no new editor. */
export interface EditorHost extends EmbedSource {
	maxLength: () => number | undefined;
	disabled: () => boolean;
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
	private composition: Composition = EMPTY_COMPOSITION;
	/** The last edit typed at the caret, so the word around it stays text until it ends. */
	private typing = false;
	/** A link that just became an embed because a character ended it, and what the text was before that. */
	private conversion: { caret: number; before: Snapshot } | null = null;
	/** Where the last edit left the caret, while it is still there: a card beside it stays shut. */
	private editedAt: number | null = null;

	constructor(
		private readonly root: HTMLElement,
		value: string,
		private readonly host: EditorHost
	) {
		this.doc = docFromText(plainText(value));
		this.draw();
	}

	/** True while the caret is where the last edit left it, so a card beside it stays shut. */
	get editedLast(): boolean {
		return this.editedAt !== null;
	}

	/** Takes focus with the caret at the end of the text. */
	focusAtEnd(): void {
		if (!this.editable()) return;

		this.root.focus({ preventScroll: true });
		this.place(this.doc.text.length);
	}

	/** Listens to the element and the document; returns the function that stops listening. */
	attach(): () => void {
		return attachEditorEvents(this.root, {
			editable: () => this.editable(),
			composing: () => this.composition.active,
			selectionRange: () => this.selectionRange(),
			insert: (range, text) => this.insert(range, text, 'type'),
			paste: (range, raw) => this.paste(range, raw),
			remove: (inputType, target) => this.remove(inputType, target),
			undo: () => this.stepHistory(undo),
			redo: () => this.stepHistory(redo),
			selectedText: (range) => withoutImageTokens(this.doc.text.slice(range.start, range.end)),
			cutRange: (range) => this.edit(replaceRange(this.doc, range, ''), range.start, 'other'),
			holdBeforeInput: () => {
				this.composition = holdBeforeInput(this.composition, this.snapshot());
			},
			adoptInput: () => this.onInput(),
			startComposition: () => this.onCompositionStart(),
			endComposition: () => this.onCompositionEnd(),
			focusFromKeyboard: () => {
				if (this.editable()) this.place(this.doc.text.length);
			},
			blur: () => this.onBlur(),
			selectionChange: () => this.onSelectionChange()
		});
	}

	/**
	 * Takes a value from outside (cleared after send, filled by a suggestion).
	 * Every link in it is an embed; the caret goes to the end when the field
	 * has focus. While composing, the value waits until the composition ends.
	 */
	setValue(value: string): void {
		const text = plainText(value);
		const deferred = deferValue(this.composition, text);

		if (deferred) {
			this.composition = deferred;

			return;
		}

		if (text === this.doc.text) return;

		this.applyValue(text);
	}

	/** Draws the embeds again, after the host's facts about them changed. */
	refresh(): void {
		const selection = this.focused() ? readSelection(this.root) : null;

		this.draw();

		if (selection) writeSelection(this.root, selection);

		this.host.onCaret();
	}

	/**
	 * The keys the editor owns: undo and redo, and Left and Right (with Shift)
	 * stepping over an embed as one character. Call it after the host's own
	 * handler, and only when that one did not prevent the key.
	 */
	keyDown(event: KeyboardEvent): void {
		if (!this.editable() || this.composition.active || event.isComposing) return;

		const action = keyAction(event);

		if (action === 'undo' || action === 'redo') {
			event.preventDefault();
			this.stepHistory(action === 'undo' ? undo : redo);

			return;
		}

		if (action !== null) this.step(event, action);
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
		if (!this.editable()) return;

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
		if (!this.editable()) return;

		const range = embedRange(this.root, embed);

		if (range) writeSelection(this.root, { anchor: range.start, focus: range.end });
	}

	/** An edit that slipped past `beforeinput` (an unhandled input type or browser fallback): the DOM is read back. */
	private onInput(): void {
		if (this.composition.active) return;

		if (!this.editable()) {
			this.draw();

			return;
		}

		const { state, before } = takeBeforeInput(this.composition);

		this.composition = state;
		this.adoptDom(before);
	}

	private onCompositionStart(): void {
		if (!this.editable()) return;

		this.composition = startComposition(this.composition, this.snapshot());
	}

	private onCompositionEnd(): void {
		const { state, outcome } = endComposition(this.composition);

		this.composition = state;

		if (outcome.kind === 'pending') {
			this.applyValue(outcome.text);

			return;
		}

		if (!this.editable()) {
			this.draw();

			return;
		}

		this.adoptDom(outcome.before);
	}

	/** Leaving the field ends the word being typed: a link in it becomes an embed. */
	private onBlur(): void {
		markSelected(this.root, null);
		this.typing = false;
		this.conversion = null;
		this.commit(null);
		this.host.onCaret();
	}

	/** Keeps the caret out of embeds and turns a typed link into an embed once the caret leaves its word. */
	private onSelectionChange(): void {
		if (this.composition.active) return;

		const selection = readSelection(this.root);

		if (!selection) return;

		const snapped = snapSelection(this.doc, selection);

		if (snapped.anchor !== selection.anchor || snapped.focus !== selection.focus) writeSelection(this.root, snapped);

		if (this.conversion && this.conversion.caret !== snapped.focus) this.conversion = null;
		if (this.editedAt !== snapped.focus || snapped.anchor !== snapped.focus) this.editedAt = null;
		if (this.typing && !isInsideWord(this.doc, snapped)) this.typing = false;

		this.commit(snapped.anchor === snapped.focus ? snapped.focus : null);
		markSelected(this.root, rangeOf(snapped));
		this.host.onCaret();
	}

	/** Applies an external value to the model and redraws, cleaning the DOM even when `text` matches `this.doc.text`. */
	private applyValue(text: string): void {
		if (text !== this.doc.text) {
			this.history = record(this.history, this.snapshot(), { kind: 'other', caret: text.length, at: Date.now() });
			this.typing = false;
			this.conversion = null;
			this.editedAt = null;
			this.doc = docFromText(text);
		}

		this.draw();

		if (this.focused() && this.editable()) this.place(text.length);

		this.host.onCaret();
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
	private remove(inputType: string, target: TextRange): void {
		const selection = this.selectionRange();
		const kind = deleteKind(inputType);
		const caret = selection.start === selection.end ? selection.start : null;

		if (kind === 'backward' && this.conversion && caret === this.conversion.caret) {
			const { before } = this.conversion;

			this.edit(before.doc, before.caret, 'other');
			this.typing = true;

			return;
		}

		const range = deletionRange(this.doc, kind, selection, target);

		if (range.start !== range.end) this.edit(replaceRange(this.doc, range, ''), range.start, 'delete');
	}

	/** Records an edit, draws it, puts the caret, and tells the host. */
	private edit(next: LinkDoc, caret: number, kind: EditKind): void {
		if (!this.editable()) return;

		const changed = next.text !== this.doc.text;

		this.history = record(this.history, this.snapshot(), { kind, caret, at: Date.now() });
		this.typing = false;
		this.conversion = null;
		this.show({ doc: next, caret });

		if (changed) this.host.onChange(next.text);
	}

	private stepHistory(pick: typeof undo): void {
		const step = pick(this.history, this.snapshot());

		if (step) this.travel(step.history, step.snapshot);
	}

	/** Shows a state from the history; the text it holds goes to the host. */
	private travel(history: History, snapshot: Snapshot): void {
		if (!this.editable()) return;

		const changed = snapshot.doc.text !== this.doc.text;

		this.history = history;
		this.typing = false;
		this.conversion = null;
		this.show(snapshot);

		if (changed) this.host.onChange(snapshot.doc.text);
	}

	/** Makes the model what the DOM shows: after a composition, or an edit the browser made without asking. */
	private adoptDom(beforeSnapshot: Snapshot | null): void {
		if (!this.editable()) return;

		const read = readDoc(this.root);
		const selection = readSelection(this.root);

		if (read.text === this.doc.text && read.links.length === this.doc.links.length) return;

		const rawCaret = selection?.focus ?? read.text.length;
		const before = beforeSnapshot ?? { doc: this.doc, caret: Math.min(rawCaret, this.doc.text.length) };
		const adopted = adoptEdit({ before: this.doc, read, caret: rawCaret, maxLength: this.host.maxLength() });

		if (adopted.doc.text === this.doc.text && adopted.doc.links.length === this.doc.links.length) {
			this.draw();
			this.place(adopted.caret);
			this.host.onCaret();

			return;
		}

		this.history = record(this.history, before, { kind: 'type', caret: adopted.caret, at: Date.now() });
		this.typing = true;
		this.conversion = null;
		this.show(adopted);
		this.host.onChange(adopted.doc.text);
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
		renderDoc(this.root, this.doc, this.host);
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

	private focused(): boolean {
		return this.root.ownerDocument.activeElement === this.root;
	}

	private editable(): boolean {
		return !this.host.disabled() && this.root.isContentEditable;
	}
}
