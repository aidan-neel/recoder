'use client';

import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Dialog } from 'radix-ui';
import type { ComponentProps, ComponentType, KeyboardEvent, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { modalMotion, scrimMotion } from '../../motion/presets';
import { useMotionVariants } from '../../motion/reduced';
import { Keycap } from '../keycap';
import { useReturnFocus } from '../overlay/return-focus';

type CommandFilter = ComponentProps<typeof Command>['filter'];

/** The palette frame: 640px wide, 14vh from the top, radius 14, floating on a deep shadow. */
const FRAME = cn(
	'fixed inset-x-0 top-[14vh] z-[120] mx-auto flex w-[calc(100vw-32px)] max-w-[640px] flex-col overflow-hidden',
	'rounded-[14px] bg-menu text-fg outline-none',
	'shadow-[0_0_0_1px_var(--line-menu),0_30px_80px_rgb(var(--shade-rgb)/0.6)]'
);

/** A click on a toast (an Undo, say) is not a click outside the palette. */
function keepOpenForToasts(event: Event): void {
	if (event.target instanceof Element && event.target.closest('[data-sonner-toaster]')) event.preventDefault();
}

interface CommandDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The dialog's accessible name ("Search Recoder"). */
	label: string;
	className?: string;
	/** Set false to filter and order the items yourself. */
	shouldFilter?: boolean;
	/** Scores an item for the query, 0 hides it; defaults to cmdk's fuzzy score. */
	filter?: CommandFilter;
	children: ReactNode;
}

/**
 * The command palette: a modal search over commands, with a scrim. Arrow keys
 * move the selection and wrap, Enter chooses, Escape closes. Clicks on toasts
 * leave it open. On close, focus returns to what had it when it opened.
 */
export function CommandDialog({
	open,
	onOpenChange,
	label,
	className,
	shouldFilter,
	filter,
	children
}: CommandDialogProps) {
	const { panelRef, restoreFocus } = useReturnFocus<HTMLDivElement>(open);
	const variants = useMotionVariants(modalMotion);

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<AnimatePresence>
				{open ? (
					<Dialog.Portal forceMount>
						<Dialog.Overlay forceMount asChild>
							<motion.div
								data-ui="command-overlay"
								variants={scrimMotion}
								initial="closed"
								animate="open"
								exit="closed"
								className="fixed inset-0 z-[115] bg-(--scrim)"
							/>
						</Dialog.Overlay>
						<Dialog.Content
							forceMount
							asChild
							aria-describedby={undefined}
							onInteractOutside={keepOpenForToasts}
							onCloseAutoFocus={restoreFocus}
						>
							<motion.div
								ref={panelRef}
								data-ui="command-dialog"
								variants={variants}
								initial="closed"
								animate="open"
								exit="closed"
								className={cn(FRAME, className)}
							>
								<Dialog.Title className="sr-only">{label}</Dialog.Title>
								<Command
									label={label}
									shouldFilter={shouldFilter}
									filter={filter}
									loop
									vimBindings={false}
									className="flex min-h-0 flex-col"
								>
									{children}
								</Command>
							</motion.div>
						</Dialog.Content>
					</Dialog.Portal>
				) : null}
			</AnimatePresence>
		</Dialog.Root>
	);
}

interface CommandInputProps {
	placeholder?: string;
	value?: string;
	onValueChange?: (value: string) => void;
	/** Before the field; a search icon by default. */
	leading?: ReactNode;
	/** After the field, faint (the scope: "in recoder #42"). */
	trailing?: ReactNode;
	/** Keys in the field, before the list's own (a Backspace that leaves a mode). */
	onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
	className?: string;
}

/** The palette's search row: 48px with a divider under it. */
export function CommandInput({
	placeholder,
	value,
	onValueChange,
	leading,
	trailing,
	onKeyDown,
	className
}: CommandInputProps) {
	return (
		<div
			data-ui="command-input"
			className={cn('flex h-12 shrink-0 items-center gap-3 border-b border-line-card px-[18px]', className)}
		>
			{leading ?? <Search aria-hidden className="size-4 shrink-0 text-fg-muted" />}
			<Command.Input
				placeholder={placeholder}
				value={value}
				onValueChange={onValueChange}
				onKeyDown={onKeyDown}
				className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-faint"
			/>
			{trailing ? (
				<span className="max-w-[160px] shrink-0 truncate text-[12.5px] text-fg-faint">{trailing}</span>
			) : null}
		</div>
	);
}

/** A titled group of results; it hides when none of its items match. */
export function CommandGroup({
	heading,
	className,
	children
}: {
	heading?: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<Command.Group heading={heading} data-ui="command-group" className={className}>
			{children}
		</Command.Group>
	);
}

interface CommandItemProps {
	/** What the search matches, and the row's identity; keep it unique. */
	value: string;
	/** More words the search matches. */
	keywords?: string[];
	onSelect?: (value: string) => void;
	icon?: ComponentType<{ className?: string }>;
	/** The icon's color (a CSS color, usually a token: `var(--sev-high)`). */
	iconTone?: string;
	/** Faint mono text at the row's end (a path, a PR number). */
	detail?: ReactNode;
	/** A key name shown as a keycap at the row's end. */
	shortcut?: string;
	disabled?: boolean;
	className?: string;
	children: ReactNode;
}

/** A 36px result row: icon, label, then detail and shortcut on the right. */
export function CommandItem({
	value,
	keywords,
	onSelect,
	icon: Icon,
	iconTone,
	detail,
	shortcut,
	disabled,
	className,
	children
}: CommandItemProps) {
	return (
		<Command.Item
			value={value}
			keywords={keywords}
			onSelect={onSelect}
			disabled={disabled}
			data-ui="command-item"
			className={cn(
				'flex h-9 cursor-default items-center gap-3 rounded-[9px] px-2.5 text-[14px] text-fg select-none',
				'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40',
				className
			)}
		>
			{Icon ? (
				<span data-ui="command-item-icon" style={{ color: iconTone }}>
					<Icon />
				</span>
			) : null}
			<span className="min-w-0 flex-1 truncate">{children}</span>
			{detail ? <span className="shrink-0 font-mono text-[12px] text-fg-faint">{detail}</span> : null}
			{shortcut ? <Keycap k={shortcut} /> : null}
		</Command.Item>
	);
}

/** Shown in place of the results when nothing matches. */
export function CommandEmpty({
	className,
	children = 'No results found'
}: {
	className?: string;
	children?: ReactNode;
}) {
	return (
		<Command.Empty
			data-ui="command-empty"
			className={cn('px-2.5 py-6 text-center text-[13px] text-fg-faint', className)}
		>
			{children}
		</Command.Empty>
	);
}

/** One footer hint: the keys, then what they do. */
export interface CommandHint {
	keys: string[];
	label: string;
}

/** The 36px footer: keycaps and what they do (`↑↓ navigate`, `↵ open`, `esc close`). */
export function CommandFooter({ hints, className }: { hints: CommandHint[]; className?: string }) {
	return (
		<div
			data-ui="command-footer"
			className={cn(
				'flex h-9 shrink-0 items-center gap-4 border-t border-line-card px-[18px] text-[12px] text-fg-faint',
				className
			)}
		>
			{hints.map((hint) => (
				<span key={hint.label} className="inline-flex items-center gap-[7px]">
					<span className="inline-flex gap-[3px]">
						{hint.keys.map((key) => (
							<Keycap key={key} k={key} />
						))}
					</span>
					{hint.label}
				</span>
			))}
		</div>
	);
}
