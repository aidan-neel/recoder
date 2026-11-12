'use client';

import { Check } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import { useContext, useState, type ComponentProps, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { MENU_SEPARATOR, MenuItemBody, MenuOpen, MenuPanel, menuItemRoot, type MenuItemProps } from './menu-parts';
import { useOpened } from './use-opened';

interface DropdownMenuProps {
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	/** Modal menus (the default) make the rest of the page inert while open. */
	modal?: boolean;
	children: ReactNode;
}

/** A menu opened from a button. Arrow keys, Home, End and typeahead move the highlight; Escape closes. */
export function DropdownMenu({
	open: openProp,
	defaultOpen = false,
	onOpenChange,
	modal,
	children
}: DropdownMenuProps) {
	const [ownOpen, setOwnOpen] = useState(defaultOpen);
	const open = openProp ?? ownOpen;

	/** Keeps the local state in step so an uncontrolled menu still animates out. */
	function change(next: boolean): void {
		setOwnOpen(next);
		onOpenChange?.(next);
	}

	return (
		<MenuOpen value={open}>
			<DropdownMenuPrimitive.Root open={open} onOpenChange={change} modal={modal}>
				{children}
			</DropdownMenuPrimitive.Root>
		</MenuOpen>
	);
}

interface DropdownMenuTriggerProps extends Omit<ComponentProps<typeof DropdownMenuPrimitive.Trigger>, 'asChild'> {
	/** One element, usually a `Button`; it receives the trigger's props and `data-state`. */
	children: ReactNode;
}

/**
 * Renders its child as the trigger (`asChild`), so a kit `Button` opens the
 * menu and shows its open state. Props from a wrapping trigger (a `Tooltip`'s
 * ref and handlers) pass through to the child.
 */
export function DropdownMenuTrigger({ children, ...props }: DropdownMenuTriggerProps) {
	return (
		<DropdownMenuPrimitive.Trigger asChild {...props}>
			{children}
		</DropdownMenuPrimitive.Trigger>
	);
}

interface DropdownMenuContentProps {
	align?: 'start' | 'center' | 'end';
	side?: 'top' | 'right' | 'bottom' | 'left';
	sideOffset?: number;
	className?: string;
	children: ReactNode;
}

/**
 * The menu panel: at least 180px or the trigger's width, fading and scaling
 * in from the trigger. It renders nothing until the menu first opens.
 */
export function DropdownMenuContent({
	align = 'start',
	side = 'bottom',
	sideOffset = 6,
	className,
	children
}: DropdownMenuContentProps) {
	const open = useContext(MenuOpen);
	const opened = useOpened(open);

	if (!opened) return null;

	return (
		<AnimatePresence>
			{open ? (
				<DropdownMenuPrimitive.Portal forceMount>
					<DropdownMenuPrimitive.Content
						forceMount
						asChild
						loop
						align={align}
						side={side}
						sideOffset={sideOffset}
						collisionPadding={8}
					>
						<MenuPanel
							data-ui="dropdown-menu-content"
							className={cn(
								'min-w-[max(180px,var(--radix-dropdown-menu-trigger-width))]',
								'max-h-(--radix-dropdown-menu-content-available-height)',
								'origin-(--radix-dropdown-menu-content-transform-origin)',
								className
							)}
						>
							{children}
						</MenuPanel>
					</DropdownMenuPrimitive.Content>
				</DropdownMenuPrimitive.Portal>
			) : null}
		</AnimatePresence>
	);
}

/** A row in a dropdown menu: optional icon, label and shortcut keycap. */
export function DropdownMenuItem({ icon, shortcut, destructive, className, children, ...props }: MenuItemProps) {
	return (
		<DropdownMenuPrimitive.Item {...menuItemRoot(destructive, className)} {...props}>
			<MenuItemBody icon={icon} shortcut={shortcut}>
				{children}
			</MenuItemBody>
		</DropdownMenuPrimitive.Item>
	);
}

interface DropdownMenuRadioGroupProps {
	/** The chosen row's value. */
	value: string;
	onValueChange: (value: string) => void;
	children: ReactNode;
}

/** Rows of which one is chosen: a filter, a sort order, a theme. The chosen row carries a check at its end. */
export function DropdownMenuRadioGroup({ value, onValueChange, children }: DropdownMenuRadioGroupProps) {
	return (
		<DropdownMenuPrimitive.RadioGroup value={value} onValueChange={onValueChange} className="contents">
			{children}
		</DropdownMenuPrimitive.RadioGroup>
	);
}

interface DropdownMenuRadioItemProps extends Omit<MenuItemProps, 'destructive' | 'shortcut'> {
	value: string;
}

/**
 * One choice in a `DropdownMenuRadioGroup`. Every row keeps room for the
 * check, so what a row shows at its end (a count) lines up down the list.
 */
export function DropdownMenuRadioItem({ icon, className, children, ...props }: DropdownMenuRadioItemProps) {
	return (
		<DropdownMenuPrimitive.RadioItem {...menuItemRoot(false, className)} {...props}>
			<MenuItemBody icon={icon}>{children}</MenuItemBody>
			<span data-ui="menu-item-check" className="w-3.5">
				<DropdownMenuPrimitive.ItemIndicator>
					<Check aria-hidden />
				</DropdownMenuPrimitive.ItemIndicator>
			</span>
		</DropdownMenuPrimitive.RadioItem>
	);
}

/** A hairline between groups of items. */
export function DropdownMenuSeparator({ className }: { className?: string }) {
	return <DropdownMenuPrimitive.Separator data-ui="menu-separator" className={cn(MENU_SEPARATOR, className)} />;
}
