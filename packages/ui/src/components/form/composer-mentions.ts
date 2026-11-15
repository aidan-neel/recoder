'use client';

import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react';

import { matchItems, type ComposerMenuItem } from './composer-commands';
import { readSelection, writeSelection } from './link-dom';

/** What the composer's "@" menu offers, and what its button is called. */
export interface ComposerMentions {
	/** The button's tooltip and the list's name for a screen reader: "Skills". */
	label: string;
	items: readonly ComposerMenuItem[];
}

/** A text and where its caret stands, after an edit the menu made. */
export interface CaretText {
	text: string;
	caret: number;
}

/** The mention being typed: where its `@` stands, and the name typed after it so far. */
export interface TypedMention {
	start: number;
	query: string;
}

/** An `@` at the start or after white space, then the name typed so far, up to the caret. */
const TYPED_MENTION = /(?:^|\s)@([^\s@]*)$/;

/**
 * The mention that ends at the caret, or null. An `@` inside a word (an
 * email address) is not one, and neither is a name the caret has left with
 * a space.
 */
export function typedMention(text: string, caret: number): TypedMention | null {
	const match = TYPED_MENTION.exec(text.slice(0, caret));

	if (!match) return null;

	const query = match[1] ?? '';

	return { start: caret - query.length - 1, query };
}

/**
 * The text once `name` is picked for the mention typed before the caret: the
 * `@` and what was typed become `@name` and a space, and the caret goes
 * after that space.
 */
export function withMention(text: string, caret: number, mention: TypedMention, name: string): CaretText {
	const before = `${text.slice(0, mention.start)}@${name}`;
	const after = text.slice(caret);
	const spaced = after.startsWith(' ') ? after : ` ${after}`;

	return { text: before + spaced, caret: before.length + 1 };
}

/** The text with an `@` put in at the caret to start a mention, a space before it when it would join a word. */
export function startMention(text: string, caret: number): CaretText {
	const before = text.slice(0, caret);
	const at = before === '' || /\s$/.test(before) ? '@' : ' @';

	return { text: before + at + text.slice(caret), caret: caret + at.length };
}

interface MentionMenuInput {
	/** The field's text, in the offsets the field's selection uses. */
	text: string;
	onTextChange: (text: string) => void;
	items: readonly ComposerMenuItem[];
	field: RefObject<HTMLElement | null>;
}

/** The "@" menu's state and the keys and picks that drive it. */
export interface MentionMenu {
	open: boolean;
	matches: ComposerMenuItem[];
	/** The row Enter or Tab picks. */
	active: number;
	setActive: (index: number) => void;
	/** Runs on the field's keys; returns true when the menu took the key. */
	keyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
	pick: (item: ComposerMenuItem) => void;
	/** The "@" button: starts a mention at the caret, or shuts the list. */
	toggle: () => void;
}

/**
 * The "@" menu. It opens while the word before the caret is an `@` and a
 * name being typed, anywhere in the text, and lists the items that match.
 * A pick puts `@name` in the text in place of what was typed. Arrow keys
 * move the active row and wrap, Enter or Tab picks it, Escape shuts the list
 * until the text changes. A name that matches nothing shuts the list, so the
 * text sends as written.
 */
export function useMentionMenu({ text, onTextChange, items, field }: MentionMenuInput): MentionMenu {
	const caret = useFieldCaret(field);
	const [dismissedAt, setDismissedAt] = useState<string | null>(null);
	const [cursor, setCursor] = useState({ query: '', index: 0 });
	const shown = listAt(caret.offset);

	/**
	 * The list for the caret at `offset`. The caret's state follows the field's
	 * selection events, which can arrive after a quick key, so a key or a pick
	 * reads the caret from the field again first.
	 */
	function listAt(offset: number | null) {
		const at = offset === null ? text.length : Math.min(offset, text.length);
		const mention = offset === null ? null : typedMention(text, at);
		const matches = mention ? matchItems(items, mention.query) : [];
		const open = matches.length > 0 && dismissedAt !== text;
		const active = mention && cursor.query === mention.query ? Math.min(cursor.index, matches.length - 1) : 0;

		return { at, mention, matches, open, active };
	}

	function current() {
		return listAt(caret.read());
	}

	function setActive(index: number): void {
		setCursor({ query: current().mention?.query ?? '', index });
	}

	function edit(next: CaretText): void {
		setDismissedAt(null);
		caret.set(next.caret);
		onTextChange(next.text);
		placeCaret(field, next.caret);
	}

	function pick(item: ComposerMenuItem): void {
		const { at, mention } = current();

		if (mention) edit(withMention(text, at, mention, item.name));
	}

	function keyDown(event: KeyboardEvent<HTMLElement>): boolean {
		const list = current();

		if (!list.open || event.nativeEvent.isComposing) return false;

		const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
		const chosen = list.matches[list.active];
		const count = list.matches.length;

		if (step !== undefined) setActive((list.active + step + count) % count);
		else if (chosen && ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab')) pick(chosen);
		else if (event.key === 'Escape') setDismissedAt(text);
		else return false;

		event.preventDefault();
		event.stopPropagation();

		return true;
	}

	function toggle(): void {
		if (shown.open) setDismissedAt(text);
		else edit(startMention(text, shown.at));
	}

	return { open: shown.open, matches: shown.matches, active: shown.active, setActive, keyDown, pick, toggle };
}

/**
 * The caret's last offset in the field, kept after the field loses focus so a
 * button can still start at it, and a way to read it from the field now.
 */
function useFieldCaret(field: RefObject<HTMLElement | null>) {
	const [offset, setOffset] = useState<number | null>(null);

	/** The caret in the field now, or null when the selection is a range or sits elsewhere. */
	function caretNow(): number | null {
		const root = field.current;
		const selection = root ? readSelection(root) : null;

		return selection && selection.anchor === selection.focus ? selection.focus : null;
	}

	useEffect(() => {
		/** Notes the caret when there is one in the field; anything else leaves the last one. */
		function follow(): void {
			const now = caretNow();

			if (now !== null) setOffset(now);
		}

		document.addEventListener('selectionchange', follow);

		return () => document.removeEventListener('selectionchange', follow);
	});

	return { offset, set: setOffset, read: () => caretNow() ?? offset };
}

/** Puts focus in the field with the caret at `offset`, a frame later, once the field has drawn the new text. */
function placeCaret(field: RefObject<HTMLElement | null>, offset: number): void {
	requestAnimationFrame(() => {
		const root = field.current;

		if (!root) return;

		root.focus();
		writeSelection(root, { anchor: offset, focus: offset });
	});
}
