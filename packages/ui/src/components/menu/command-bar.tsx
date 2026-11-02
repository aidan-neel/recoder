'use client';

import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ComponentProps, FocusEvent, KeyboardEvent, MouseEvent, ReactNode, Ref } from 'react';

import { cn } from '../../lib/cn';
import { menuMotion } from '../../motion/presets';
import { useMotionVariants } from '../../motion/reduced';
import { focusInput } from '../form/input';

type CommandFilter = ComponentProps<typeof Command>['filter'];

interface CommandBarProps {
	/** The bar's accessible name ("Review a pull request"). */
	label: string;
	/** The highlighted item's value; pass it to read which row Enter would run. */
	value?: string;
	onValueChange?: (value: string) => void;
	/** Set false to filter and order the items yourself. */
	shouldFilter?: boolean;
	filter?: CommandFilter;
	/** Keys anywhere in the bar, before its own; `preventDefault` keeps the bar from acting on one. */
	onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
	/** Focus came into the bar or left it, so the page can open or close its results. */
	onFocusChange?: (focused: boolean) => void;
	className?: string;
	children: ReactNode;
}

/**
 * A command search that lives in the page instead of a dialog: a field with
 * its results floating under it. Arrow keys move the highlight and wrap,
 * Enter runs the highlighted row. Focus moving between the field and the
 * results counts as staying in the bar.
 */
export function CommandBar({
	label,
	value,
	onValueChange,
	shouldFilter,
	filter,
	onKeyDown,
	onFocusChange,
	className,
	children
}: CommandBarProps) {
	function onBlur(event: FocusEvent<HTMLDivElement>): void {
		if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocusChange?.(false);
	}

	return (
		<Command
			label={label}
			value={value}
			onValueChange={onValueChange}
			shouldFilter={shouldFilter}
			filter={filter}
			loop
			vimBindings={false}
			data-ui="command-bar"
			className={cn('relative', className)}
			onKeyDown={onKeyDown}
			onFocus={() => onFocusChange?.(true)}
			onBlur={onBlur}
		>
			{children}
		</Command>
	);
}

interface CommandBarInputProps {
	placeholder?: string;
	value?: string;
	onValueChange?: (value: string) => void;
	/** Before the field; a search icon by default. */
	leading?: ReactNode;
	/** After the field: a keycap at rest, a status while something runs. */
	trailing?: ReactNode;
	inputRef?: Ref<HTMLInputElement>;
	'aria-describedby'?: string;
	className?: string;
}

/** The bar's 44px field. A press anywhere on it focuses the input; focus lifts the ring and adds the field halo. */
export function CommandBarInput({
	placeholder,
	value,
	onValueChange,
	leading,
	trailing,
	inputRef,
	'aria-describedby': describedBy,
	className
}: CommandBarInputProps) {
	return (
		<div
			data-ui="command-bar-field"
			className={cn('flex h-11 items-center gap-3 px-3.5', className)}
			onMouseDown={focusInput}
		>
			{leading ?? <Search aria-hidden className="size-4 shrink-0 text-fg-muted" />}
			<Command.Input
				ref={inputRef}
				placeholder={placeholder}
				value={value}
				onValueChange={onValueChange}
				aria-describedby={describedBy}
				className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] text-fg outline-none placeholder:text-fg-faint"
			/>
			{trailing ? (
				<span className="flex shrink-0 items-center gap-2 text-[12.5px] text-fg-faint">{trailing}</span>
			) : null}
		</div>
	);
}

/** A press inside the results keeps focus in the field, so the bar stays open and typing carries on. */
function keepFocus(event: MouseEvent<HTMLDivElement>): void {
	event.preventDefault();
}

/**
 * The bar's results, floating 6px under the field on the menu surface. They
 * enter and leave like a menu (a short fade, a 0.95 scale and a 2px blur).
 * Hold a `CommandList` and, if the bar has one, a `CommandFooter`.
 */
export function CommandBarPanel({
	open,
	className,
	children
}: {
	open: boolean;
	className?: string;
	children: ReactNode;
}) {
	const variants = useMotionVariants(menuMotion);

	return (
		<AnimatePresence>
			{open ? (
				<motion.div
					data-ui="command-bar-panel"
					variants={variants}
					initial="closed"
					animate="open"
					exit="closed"
					className={cn(
						'absolute inset-x-0 top-[calc(100%+6px)] z-30 flex origin-top flex-col overflow-hidden',
						'rounded-[12px] bg-menu text-fg shadow-(--shadow-menu)',
						className
					)}
					onMouseDown={keepFocus}
				>
					{children}
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}
