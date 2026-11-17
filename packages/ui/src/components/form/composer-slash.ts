'use client';

import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react';

import { matchItems, type ComposerCommand, type ComposerMenuItem } from './composer-commands';
import { readSelection, writeSelection } from './link-dom';

/** One row of the "/" menu: a command, whose pick puts its prompt in the text, or a skill, whose pick names it. */
export type SlashRow = { kind: 'command'; item: ComposerCommand } | { kind: 'skill'; item: ComposerMenuItem };

/** A text and where its caret stands, after an edit the menu made. */
export interface CaretText {
	text: string;
	caret: number;
}

/** The slash word being typed: where its `/` stands, and the name typed after it so far. */
export interface TypedSlash {
	start: number;
	query: string;
}

/** A `/` at the start or after white space, then the name typed so far, up to the caret. An image's token ends it. */
const TYPED_SLASH = /(?:^|\s)\/([^\s/￼]*)$/u;

/**
 * The slash word that ends at the caret, or null. A `/` inside a word (a
 * path such as `src/app`) is not one, and neither is a name the caret has
 * left with a space.
 */
export function typedSlash(text: string, caret: number): TypedSlash | null {
	const match = TYPED_SLASH.exec(text.slice(0, caret));

	if (!match) return null;

	const query = match[1] ?? '';

	return { start: caret - query.length - 1, query };
}

/** The rows that match a query: the commands first, then the skills, each group ranked by `matchItems`. */
export function slashRows(
	commands: readonly ComposerCommand[],
	skills: readonly ComposerMenuItem[],
	query: string
): SlashRow[] {
	return [
		...matchItems(commands, query).map((item): SlashRow => ({ kind: 'command', item })),
		...matchItems(skills, query).map((item): SlashRow => ({ kind: 'skill', item }))
	];
}

/**
 * The text once `row` is picked for the slash word typed before the caret.
 * A command's prompt takes the word's place, and the caret goes after it. A
 * skill becomes `/name` and a space, and the caret goes after that space.
 * The words around stay as they were.
 */
export function withPick(text: string, caret: number, typed: TypedSlash, row: SlashRow): CaretText {
	const before = text.slice(0, typed.start);
	const after = text.slice(caret);

	if (row.kind === 'command') {
		const picked = `${before}${row.item.prompt}`;

		return { text: picked + after, caret: picked.length };
	}

	const named = `${before}/${row.item.name}`;
	const spaced = after.startsWith(' ') ? after : ` ${after}`;

	return { text: named + spaced, caret: named.length + 1 };
}

/** The text with a `/` at the caret, after a space when a word ends there, and the caret after the slash. */
export function withSlash(text: string, caret: number): CaretText {
	const before = text.slice(0, caret);
	const slash = before === '' || /\s$/u.test(before) ? '/' : ' /';

	return { text: before + slash + text.slice(caret), caret: caret + slash.length };
}

interface SlashMenuInput {
	/** The field's text, in the offsets the field's selection uses. */
	text: string;
	onTextChange: (text: string) => void;
	commands: readonly ComposerCommand[];
	skills: readonly ComposerMenuItem[];
	field: RefObject<HTMLElement | null>;
}

/** The "/" menu's state and the keys and picks that drive it. */
export interface SlashMenu {
	open: boolean;
	rows: SlashRow[];
	/** The row Enter or Tab picks. */
	active: number;
	setActive: (index: number) => void;
	/** Runs on the field's keys; returns true when the menu took the key. */
	keyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
	pick: (row: SlashRow) => void;
	/**
	 * The "/" button: shuts the list when it is open, opens it again over a slash word Escape shut, and otherwise
	 * types a `/` at the caret, which opens it.
	 */
	toggle: () => void;
}

/**
 * The "/" menu. It opens as soon as the word before the caret is a `/`,
 * anywhere in the text, and lists the commands and skills whose names match
 * what follows it. A pick puts the command's prompt or `/name` in place of
 * what was typed. Arrow keys move the active row and wrap, Enter or Tab
 * picks it, Escape shuts the list until the text changes. A name that
 * matches nothing shuts the list, so the text sends as written.
 */
export function useSlashMenu({ text, onTextChange, commands, skills, field }: SlashMenuInput): SlashMenu {
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
		const typed = offset === null ? null : typedSlash(text, at);
		const rows = typed ? slashRows(commands, skills, typed.query) : [];
		const open = rows.length > 0 && dismissedAt !== text;
		const active = typed && cursor.query === typed.query ? Math.min(cursor.index, rows.length - 1) : 0;

		return { at, typed, rows, open, active };
	}

	function current() {
		return listAt(caret.read());
	}

	function setActive(index: number): void {
		setCursor({ query: current().typed?.query ?? '', index });
	}

	function edit(next: CaretText): void {
		setDismissedAt(null);
		caret.set(next.caret);
		onTextChange(next.text);
		placeCaret(field, next.caret);
	}

	function pick(row: SlashRow): void {
		const { at, typed } = current();

		if (typed) edit(withPick(text, at, typed, row));
	}

	function keyDown(event: KeyboardEvent<HTMLElement>): boolean {
		const list = current();

		if (!list.open || event.nativeEvent.isComposing) return false;

		const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
		const chosen = list.rows[list.active];
		const count = list.rows.length;

		if (step !== undefined) setActive((list.active + step + count) % count);
		else if (chosen && ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab')) pick(chosen);
		else if (event.key === 'Escape') setDismissedAt(text);
		else return false;

		event.preventDefault();
		event.stopPropagation();

		return true;
	}

	function toggle(): void {
		const list = current();

		if (list.open) setDismissedAt(text);
		else if (list.rows.length > 0) edit({ text, caret: list.at });
		else edit(withSlash(text, list.at));
	}

	return { open: shown.open, rows: shown.rows, active: shown.active, setActive, keyDown, pick, toggle };
}

/**
 * The caret's last offset in the field, which the list draws from, and a way
 * to read it from the field now.
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
