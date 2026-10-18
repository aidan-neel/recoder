'use client';

import { AnimatePresence } from 'motion/react';
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode, type RefObject } from 'react';

import { cn } from '../../lib/cn';
import { rememberOpener } from '../overlay/return-focus';
import { MENU_SEPARATOR, MenuItemBody, MenuOpen, MenuPanel, menuItemRoot, type MenuItemProps } from './menu-parts';

/** What had focus when the nearest context menu opened. */
const Opener = createContext<RefObject<Element | null>>({ current: null });

interface ContextMenuProps {
	onOpenChange?: (open: boolean) => void;
	/** Modal menus (the default) make the rest of the page inert while open. */
	modal?: boolean;
	children: ReactNode;
}

/**
 * A menu opened by a right click (or the context-menu key) at the pointer,
 * with the dropdown's look and keys. It notes what had focus as it opened,
 * so a dialog opened from one of its items returns focus there on close.
 */
export function ContextMenu({ onOpenChange, modal, children }: ContextMenuProps) {
	const [open, setOpen] = useState(false);
	const opener = useRef<Element | null>(null);

	/** Radix keeps the open state; mirroring it lets the content animate out. */
	function change(next: boolean): void {
		if (next) opener.current = document.activeElement;

		setOpen(next);
		onOpenChange?.(next);
	}

	return (
		<MenuOpen value={open}>
			<Opener value={opener}>
				<ContextMenuPrimitive.Root onOpenChange={change} modal={modal}>
					{children}
				</ContextMenuPrimitive.Root>
			</Opener>
		</MenuOpen>
	);
}

interface ContextMenuTriggerProps {
	/** The region that opens the menu on right click; it receives the trigger's props and `data-state`. */
	children: ReactNode;
	disabled?: boolean;
	className?: string;
}

/** Renders its child as the right-click region (`asChild`). */
export function ContextMenuTrigger({ children, disabled, className }: ContextMenuTriggerProps) {
	return (
		<ContextMenuPrimitive.Trigger asChild disabled={disabled} className={className}>
			{children}
		</ContextMenuPrimitive.Trigger>
	);
}

/** The menu panel, placed at the pointer and scaling in from it. */
export function ContextMenuContent({ className, children }: { className?: string; children: ReactNode }) {
	const open = useContext(MenuOpen);
	const opener = useContext(Opener);

	const panelRef = useCallback(
		(panel: HTMLDivElement | null) => {
			if (panel && opener.current) rememberOpener(panel, opener.current);
		},
		[opener]
	);

	return (
		<AnimatePresence>
			{open ? (
				<ContextMenuPrimitive.Portal forceMount>
					<ContextMenuPrimitive.Content forceMount asChild loop collisionPadding={8}>
						<MenuPanel
							ref={panelRef}
							data-ui="context-menu-content"
							className={cn(
								'max-h-(--radix-context-menu-content-available-height)',
								'origin-(--radix-context-menu-content-transform-origin)',
								className
							)}
						>
							{children}
						</MenuPanel>
					</ContextMenuPrimitive.Content>
				</ContextMenuPrimitive.Portal>
			) : null}
		</AnimatePresence>
	);
}

/** A row in a context menu: optional icon, label and shortcut keycap. */
export function ContextMenuItem({ icon, shortcut, destructive, className, children, ...props }: MenuItemProps) {
	return (
		<ContextMenuPrimitive.Item {...menuItemRoot(destructive, className)} {...props}>
			<MenuItemBody icon={icon} shortcut={shortcut}>
				{children}
			</MenuItemBody>
		</ContextMenuPrimitive.Item>
	);
}

/** A hairline between groups of items. */
export function ContextMenuSeparator({ className }: { className?: string }) {
	return <ContextMenuPrimitive.Separator data-ui="menu-separator" className={cn(MENU_SEPARATOR, className)} />;
}
