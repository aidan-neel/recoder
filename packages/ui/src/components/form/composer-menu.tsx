'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useState, type KeyboardEvent, type RefObject } from 'react';

import { menuMotion } from '../../motion/presets';
import { useMotionVariants } from '../../motion/reduced';
import { PRESENCE } from '../overlay/panel';
import { MenuHighlight } from '../menu/menu-highlight';
import { matchCommands, typedCommand, withCommand, type ComposerCommand } from './composer-commands';

/** Where the menu opens: over the composer when it sits at a pane's foot, under it when it sits high on a page. */
export type ComposerMenuSide = 'top' | 'bottom';

interface CommandMenuInput {
	value: string;
	onValueChange: (value: string) => void;
	commands: readonly ComposerCommand[];
	/** The field, so a pick or the "/" button can hand focus back to it with the caret at the end. */
	field: RefObject<HTMLElement | null>;
}

/** The "/" menu's state and the keys and picks that drive it. */
export interface CommandMenu {
	open: boolean;
	matches: ComposerCommand[];
	/** The row Enter or Tab picks. */
	active: number;
	setActive: (index: number) => void;
	/** Runs first on the field's keys; returns true when the menu took the key. */
	keyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
	pick: (command: ComposerCommand) => void;
	/** The "/" button: starts a command in an empty field, opens or shuts the list over text already typed. */
	toggle: () => void;
	/** The field's own edits, which end a list the button opened. */
	edit: (value: string) => void;
}

/**
 * Puts focus in the field with the caret after its last character. The field
 * draws a new value in a layout effect, so this waits a frame for it.
 */
export function focusAtEnd(field: RefObject<HTMLElement | null>): void {
	requestAnimationFrame(() => {
		const node = field.current;
		const selection = window.getSelection();

		if (!node || !selection) return;

		node.focus();
		selection.selectAllChildren(node);
		selection.collapseToEnd();
	});
}

/**
 * The "/" menu. It opens while the field holds a slash and a command name
 * being typed, or when the "/" button opens it over text already typed, and
 * lists the commands that match. Arrow keys move the active row and wrap,
 * Enter or Tab picks it, Escape shuts the list until the text changes. A
 * name that matches nothing shuts the list, so the text sends as written.
 */
export function useCommandMenu({ value, onValueChange, commands, field }: CommandMenuInput): CommandMenu {
	const [forced, setForced] = useState(false);
	const [dismissedAt, setDismissedAt] = useState<string | null>(null);
	const [cursor, setCursor] = useState({ query: '', index: 0 });
	const query = typedCommand(value) ?? (forced ? '' : null);
	const matches = query === null ? [] : matchCommands(commands, query);
	const open = matches.length > 0 && dismissedAt !== value;
	const active = cursor.query === query ? Math.min(cursor.index, matches.length - 1) : 0;

	function setActive(index: number): void {
		setCursor({ query: query ?? '', index });
	}

	function close(): void {
		setForced(false);
		setDismissedAt(value);
	}

	function pick(command: ComposerCommand): void {
		setForced(false);
		onValueChange(withCommand(value, command));
		focusAtEnd(field);
	}

	function keyDown(event: KeyboardEvent<HTMLElement>): boolean {
		if (!open || event.nativeEvent.isComposing) return false;

		const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
		const chosen = matches[active];

		if (step !== undefined) setActive((active + step + matches.length) % matches.length);
		else if (chosen && ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab')) pick(chosen);
		else if (event.key === 'Escape') close();
		else return false;

		event.preventDefault();
		event.stopPropagation();

		return true;
	}

	function toggle(): void {
		if (open) {
			close();

			return;
		}

		setDismissedAt(null);

		if (value.trim() === '') onValueChange('/');
		else setForced(true);

		focusAtEnd(field);
	}

	function edit(next: string): void {
		setForced(false);
		onValueChange(next);
	}

	return { open, matches, active, setActive, keyDown, pick, toggle, edit };
}

interface ComposerMenuProps {
	menu: CommandMenu;
	/** The listbox's id, which the field points at. */
	id: string;
	side: ComposerMenuSide;
}

/** The id of a command's row, for the field's `aria-activedescendant`. */
export function commandOptionId(menuId: string, command: ComposerCommand): string {
	return `${menuId}-${command.name}`;
}

/**
 * The list of commands, floating over or under the composer from its left
 * edge, on the menu surface. Focus stays in the field; the pointer picks without
 * taking it. Rows show the command in mono, then what it does.
 */
export function ComposerMenu({ menu, id, side }: ComposerMenuProps) {
	const variants = useMotionVariants(menuMotion);

	return (
		<AnimatePresence>
			{menu.open ? (
				<motion.div
					{...PRESENCE}
					key="menu"
					variants={variants}
					data-ui="composer-menu"
					data-side={side}
					onMouseDown={(event) => event.preventDefault()}
				>
					<div id={id} role="listbox" aria-label="Commands" data-ui="composer-menu-list">
						<MenuHighlight selector="[aria-selected='true']" />
						{menu.matches.map((command, index) => (
							<div
								key={command.name}
								id={commandOptionId(id, command)}
								role="option"
								aria-selected={index === menu.active}
								data-ui="composer-menu-item"
								onPointerMove={() => menu.setActive(index)}
								onClick={() => menu.pick(command)}
							>
								<span data-ui="composer-menu-name">/{command.name}</span>
								<span data-ui="composer-menu-description">{command.description}</span>
							</div>
						))}
					</div>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}
