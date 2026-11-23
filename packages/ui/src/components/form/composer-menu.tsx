'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, type RefObject } from 'react';

import { menuMotion } from '../../motion/presets';
import { useMotionVariants } from '../../motion/reduced';
import { Icon } from '../icon';
import { PRESENCE } from '../overlay/panel';
import { MenuHighlight } from '../menu/menu-highlight';
import type { SlashMenu, SlashRow } from './composer-slash';

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

/** The id of a row, for the field's `aria-activedescendant`; the kind keeps a skill and a command of one name apart. */
export function slashOptionId(menuId: string, row: SlashRow): string {
	return `${menuId}-${row.kind}-${row.item.name}`;
}

interface ComposerMenuProps {
	menu: SlashMenu;
	/** The listbox's id, which the field points at. */
	id: string;
}

/**
 * The "/" list, floating over the composer across its width: the commands
 * under a "Commands" label, then the skills under "Skills", a hairline
 * between. A row shows its glyph, its name and what it is on one line.
 * Focus stays in the field; the pointer picks without taking it.
 */
export function ComposerMenu({ menu, id }: ComposerMenuProps) {
	const variants = useMotionVariants(menuMotion);
	const activeRow = menu.open ? menu.rows[menu.active] : undefined;
	const activeId = activeRow ? slashOptionId(id, activeRow) : null;
	const commands = menu.rows.filter((row) => row.kind === 'command');
	const skills = menu.rows.filter((row) => row.kind === 'skill');

	/** Arrow keys can move the active row past the list's scroll, so it is brought back into view. */
	useEffect(() => {
		if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
	}, [activeId]);

	return (
		<AnimatePresence>
			{menu.open ? (
				<motion.div
					{...PRESENCE}
					key="menu"
					variants={variants}
					data-ui="composer-menu"
					onMouseDown={(event) => event.preventDefault()}
				>
					<div id={id} role="listbox" aria-label="Commands and skills" data-ui="composer-menu-list">
						<MenuHighlight selector="[aria-selected='true']" />
						<MenuGroup label="Commands" rows={commands} menu={menu} menuId={id} />
						{commands.length > 0 && skills.length > 0 ? (
							<div role="separator" data-ui="composer-menu-separator" />
						) : null}
						<MenuGroup label="Skills" rows={skills} menu={menu} menuId={id} />
					</div>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}

interface MenuGroupProps {
	label: string;
	rows: SlashRow[];
	menu: SlashMenu;
	menuId: string;
}

/** One kind of row under its label; nothing when no row of the kind matches. */
function MenuGroup({ label, rows, menu, menuId }: MenuGroupProps) {
	const labelId = useId();

	if (rows.length === 0) return null;

	return (
		<div role="group" aria-labelledby={labelId} data-ui="composer-menu-group">
			<div id={labelId} data-ui="composer-menu-label">
				{label}
			</div>
			{rows.map((row) => (
				<MenuRow key={row.item.name} row={row} menu={menu} menuId={menuId} />
			))}
		</div>
	);
}

/** A row: a command reads `/name`, a skill its bare name, then what it is. */
function MenuRow({ row, menu, menuId }: { row: SlashRow; menu: SlashMenu; menuId: string }) {
	const index = menu.rows.indexOf(row);

	return (
		<div
			id={slashOptionId(menuId, row)}
			role="option"
			aria-selected={index === menu.active}
			data-ui="composer-menu-item"
			onPointerMove={() => menu.setActive(index)}
			onClick={() => menu.pick(row)}
		>
			<Icon name={row.kind === 'command' ? 'chat' : 'extension'} data-ui="composer-menu-glyph" />
			<span data-ui="composer-menu-name">{row.kind === 'command' ? `/${row.item.name}` : row.item.name}</span>
			<span data-ui="composer-menu-description">{row.item.description}</span>
		</div>
	);
}
