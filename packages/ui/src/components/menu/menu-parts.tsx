'use client';

import { motion, type HTMLMotionProps } from 'motion/react';
import { createContext, type ReactNode, type Ref } from 'react';

import { cn } from '../../lib/cn';
import { menuMotion } from '../../motion/presets';
import { useMotionVariants } from '../../motion/reduced';
import { Keycap } from '../keycap';
import { MenuHighlight } from './menu-highlight';

/**
 * Whether the nearest DropdownMenu or ContextMenu is open. Its content stays
 * mounted through the exit animation, so the root owns the open state.
 */
export const MenuOpen = createContext(false);

/** The floating surface menus, selects and their lists share: radius 12, menu background, menu shadow. */
const PANEL = cn(
	'relative z-[130] flex min-w-[180px] flex-col gap-px rounded-[12px] bg-menu p-1 text-fg outline-none',
	'thin-scroll overflow-y-auto overscroll-contain shadow-(--shadow-menu)'
);

/** A 30px menu row. Items carry no background of their own; the traveling highlight sits under them. */
export const MENU_ITEM = cn(
	'flex h-[30px] shrink-0 cursor-default items-center gap-3 rounded-[7px] px-2.5',
	'text-[13px] leading-[18px] text-fg outline-none select-none',
	'data-disabled:pointer-events-none data-disabled:opacity-40 data-[tone=danger]:text-danger'
);

/** A hairline between groups of items. */
export const MENU_SEPARATOR = 'mx-1 my-[3px] h-px shrink-0 bg-line-control';

interface MenuPanelProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
	/** Lists that scroll inside the panel (Select's viewport) place their own highlight. */
	highlight?: boolean;
	ref?: Ref<HTMLDivElement>;
	children: ReactNode;
}

/**
 * The menu panel, entering with `menuMotion` (a fade only under reduced
 * motion). Radix content renders into it through `asChild`.
 */
export function MenuPanel({ highlight = true, className, children, ref, ...props }: MenuPanelProps) {
	const variants = useMotionVariants(menuMotion);

	return (
		<motion.div
			ref={ref}
			variants={variants}
			initial="closed"
			animate="open"
			exit="closed"
			className={cn(PANEL, className)}
			{...props}
		>
			{highlight ? <MenuHighlight /> : null}
			{children}
		</motion.div>
	);
}

interface MenuItemBodyProps {
	icon?: ReactNode;
	shortcut?: string;
	children: ReactNode;
}

/** An item's icon, label and shortcut, in the order every menu row uses. */
export function MenuItemBody({ icon, shortcut, children }: MenuItemBodyProps) {
	return (
		<>
			{icon ? <span data-ui="menu-item-icon">{icon}</span> : null}
			<span className="min-w-0 flex-1 truncate">{children}</span>
			{shortcut ? <Keycap k={shortcut} /> : null}
		</>
	);
}

/** Props every menu row shares (DropdownMenu and ContextMenu). */
export interface MenuItemProps {
	/** A 15px icon before the label, in `text-fg-subtle`. */
	icon?: ReactNode;
	/** A key name shown as a keycap at the row's end (`mod+k`, `Enter`, `d`). */
	shortcut?: string;
	/** Colors the row as dangerous (delete, discard). */
	destructive?: boolean;
	disabled?: boolean;
	/** Runs when the item is chosen. Call `event.preventDefault()` to keep the menu open. */
	onSelect?: (event: Event) => void;
	className?: string;
	children: ReactNode;
}

/** The hooks and classes a menu row's root carries. */
export function menuItemRoot(destructive: boolean | undefined, className: string | undefined) {
	return {
		'data-ui': 'menu-item',
		'data-tone': destructive ? 'danger' : undefined,
		className: cn(MENU_ITEM, className)
	};
}
