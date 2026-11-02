'use client';

import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Dialog } from 'radix-ui';
import {
	useLayoutEffect,
	useRef,
	useState,
	type ComponentProps,
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
	type RefObject
} from 'react';

import { cn } from '../../lib/cn';
import { menuMotion } from '../../motion/presets';
import { useMotionVariants } from '../../motion/reduced';
import { focusInput } from '../form/input';
import { Layer, PRESENCE, Scrim } from '../overlay/panel';
import { useReturnFocus } from '../overlay/return-focus';

type CommandFilter = ComponentProps<typeof Command>['filter'];

/** The 44px field, shared by the resting trigger and the live field over it, so the swap between them never shows. */
const FIELD = 'flex h-11 w-full items-center gap-3 px-3.5 text-left';

/** The room kept under the results, so the card never touches the window's bottom edge. */
const BOTTOM_ROOM = 16;

/** The gap between the field and its results. */
const PANEL_GAP = 6;

/** Where the resting field sits in the window, so the open bar lands exactly on top of it. */
interface AnchorRect {
	top: number;
	left: number;
	width: number;
	bottom: number;
}

/**
 * Measures the resting field while the bar is open, before paint, and again
 * whenever it or the window resizes. The page behind cannot scroll while the
 * bar is open, so nothing else moves it. The last rect stays after closing so
 * the bar leaves from where it was.
 */
function useAnchorRect(anchor: RefObject<HTMLElement | null>, open: boolean): AnchorRect | null {
	const [rect, setRect] = useState<AnchorRect | null>(null);

	useLayoutEffect(() => {
		const node = anchor.current;

		if (!open || !node) return;

		function measure(): void {
			const box = node!.getBoundingClientRect();

			setRect({ top: box.top, left: box.left, width: box.width, bottom: box.bottom });
		}

		measure();

		const observer = new ResizeObserver(measure);

		observer.observe(node);
		window.addEventListener('resize', measure);

		return () => {
			observer.disconnect();
			window.removeEventListener('resize', measure);
		};
	}, [anchor, open]);

	return rect;
}

/** The open bar's box: on the resting field, with the room left under it for the results. */
function anchoredStyle(rect: AnchorRect): CSSProperties {
	const room = Math.max(160, window.innerHeight - rect.bottom - PANEL_GAP - BOTTOM_ROOM);

	return { top: rect.top, left: rect.left, width: rect.width, '--command-bar-room': `${room}px` } as CSSProperties;
}

/** A click on a toast (an Undo, say) is not a click outside the bar. */
function keepOpenForToasts(event: Event): void {
	if (event.target instanceof Element && event.target.closest('[data-sonner-toaster]')) event.preventDefault();
}

/** Enter on a control in the results (a switch, a button) belongs to that control, not to the highlighted row. */
function keepControlKeys(event: KeyboardEvent<HTMLDivElement>): void {
	if (event.key === 'Enter') event.stopPropagation();
}

interface CommandBarProps {
	/** The bar's accessible name ("Review a pull request"). */
	label: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	placeholder?: string;
	/** The text in the field. */
	search?: string;
	onSearchChange?: (search: string) => void;
	/** Before the field's text; a search icon by default. */
	leading?: ReactNode;
	/** At the resting field's end: the key that opens it. */
	hint?: ReactNode;
	/** The highlighted row's value; pass it to read which row Enter would run. */
	value?: string;
	onValueChange?: (value: string) => void;
	/** Set false to filter and order the items yourself. */
	shouldFilter?: boolean;
	filter?: CommandFilter;
	/** Keys anywhere in the open bar, before its own; `preventDefault` keeps the bar from acting on one. */
	onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
	className?: string;
	/** The results card's content: a `CommandList` and, if the bar has one, a `CommandFooter`. */
	children: ReactNode;
}

/**
 * A command search that lives in the page: a 44px field that opens in place
 * as a small modal. At rest it is a button. Open, the page dims under the
 * modal scrim and a live field lands exactly on the resting one, with its
 * results floating under it on the menu surface (a short fade, a 0.95 scale
 * and a 2px blur). Focus stays inside the bar, the page behind takes no
 * pointer or scroll, Escape or a click outside closes it, and focus returns
 * to what had it before. Arrow keys move the highlight and wrap; Enter runs
 * the highlighted row.
 */
export function CommandBar({
	label,
	open,
	onOpenChange,
	placeholder,
	search,
	onSearchChange,
	leading,
	hint,
	value,
	onValueChange,
	shouldFilter,
	filter,
	onKeyDown,
	className,
	children
}: CommandBarProps) {
	const anchor = useRef<HTMLDivElement>(null);
	const rect = useAnchorRect(anchor, open);
	const { panelRef, restoreFocus } = useReturnFocus<HTMLDivElement>(open);
	const variants = useMotionVariants(menuMotion);
	const lead = leading ?? <Search aria-hidden className="size-4 shrink-0 text-fg-muted" />;

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<div ref={anchor} data-ui="command-bar" className={cn('relative', className)}>
				<Dialog.Trigger asChild>
					<button type="button" aria-label={label} data-ui="command-bar-field" data-slot="trigger" className={FIELD}>
						{lead}
						<span className="min-w-0 flex-1 truncate text-[14.5px] text-fg-faint">{placeholder}</span>
						{hint ? <span className="flex shrink-0 items-center">{hint}</span> : null}
					</button>
				</Dialog.Trigger>
			</div>
			<AnimatePresence>
				{open && rect ? (
					<Dialog.Portal forceMount>
						<Layer>
							<Dialog.Overlay forceMount asChild>
								<Scrim />
							</Dialog.Overlay>
							<Dialog.Content
								forceMount
								asChild
								aria-describedby={undefined}
								onInteractOutside={keepOpenForToasts}
								onCloseAutoFocus={restoreFocus}
							>
								<div
									ref={panelRef}
									data-ui="command-bar-dialog"
									style={anchoredStyle(rect)}
									className="fixed outline-none"
								>
									<Dialog.Title className="sr-only">{label}</Dialog.Title>
									<Command
										label={label}
										value={value}
										onValueChange={onValueChange}
										shouldFilter={shouldFilter}
										filter={filter}
										loop
										vimBindings={false}
										onKeyDown={onKeyDown}
									>
										<div data-ui="command-bar-field" data-slot="field" className={FIELD} onMouseDown={focusInput}>
											{lead}
											<Command.Input
												placeholder={placeholder}
												value={search}
												onValueChange={onSearchChange}
												className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] text-fg outline-none placeholder:text-fg-faint"
											/>
										</div>
										<motion.div
											{...PRESENCE}
											data-ui="command-bar-panel"
											variants={variants}
											className={cn(
												'mt-1.5 flex max-h-(--command-bar-room) origin-top flex-col overflow-hidden',
												'rounded-[12px] bg-menu text-fg shadow-(--shadow-menu)'
											)}
											onKeyDown={keepControlKeys}
										>
											{children}
										</motion.div>
									</Command>
								</div>
							</Dialog.Content>
						</Layer>
					</Dialog.Portal>
				) : null}
			</AnimatePresence>
		</Dialog.Root>
	);
}
