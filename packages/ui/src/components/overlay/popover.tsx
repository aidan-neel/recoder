'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { menuMotion } from '../../motion/presets';
import { useMotionVariants } from '../../motion/reduced';
import { PRESENCE } from './panel';
import { useOpenState, type OpenProps } from './use-open-state';

/** Whether the nearest popover is open, so its panel stays mounted until the exit animation ends. */
const PopoverOpen = createContext(false);

/**
 * A click-triggered floating panel. Controlled with `open` and
 * `onOpenChange`, or uncontrolled with `defaultOpen`. A click outside or
 * Escape closes it; inside a modal, Escape closes the popover first.
 */
export function Popover({ children, ...state }: OpenProps) {
	const [open, setOpen] = useOpenState(state);

	return (
		<PopoverOpen value={open}>
			<PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
				{children}
			</PopoverPrimitive.Root>
		</PopoverOpen>
	);
}

/** The control that toggles the popover; it renders its child and marks it `data-state="open"` while open. */
export function PopoverTrigger({ children }: { children: ReactElement }) {
	return <PopoverPrimitive.Trigger asChild>{children}</PopoverPrimitive.Trigger>;
}

interface PopoverContentProps {
	side?: 'top' | 'right' | 'bottom' | 'left';
	align?: 'start' | 'center' | 'end';
	/** Gap between the trigger and the panel, in px. */
	sideOffset?: number;
	className?: string;
	children?: ReactNode;
	/** Runs when the panel opens and takes focus; prevent it to keep focus where it was. */
	onOpenAutoFocus?: (event: Event) => void;
}

/**
 * The floating panel: menu surface, 12px radius and padding. It grows from
 * the side it is anchored to (130ms in, 80ms out), flips and shifts to stay
 * 8px inside the viewport, and scrolls when taller than the room it has.
 */
export function PopoverContent({
	side = 'bottom',
	align = 'center',
	sideOffset = 8,
	className,
	children,
	onOpenAutoFocus
}: PopoverContentProps) {
	const open = useContext(PopoverOpen);
	const variants = useMotionVariants(menuMotion);

	return (
		<AnimatePresence>
			{open ? (
				<PopoverPrimitive.Portal forceMount>
					<PopoverPrimitive.Content
						forceMount
						asChild
						side={side}
						align={align}
						sideOffset={sideOffset}
						collisionPadding={8}
						onOpenAutoFocus={onOpenAutoFocus}
					>
						<motion.div
							{...PRESENCE}
							data-ui="popover-content"
							variants={variants}
							className={cn(
								'z-[130] max-h-(--radix-popover-content-available-height) max-w-(--radix-popover-content-available-width)',
								'origin-(--radix-popover-content-transform-origin) overflow-auto overscroll-contain',
								'rounded-[12px] bg-menu p-3 text-fg shadow-(--shadow-menu) outline-none thin-scroll',
								'data-[state=closed]:pointer-events-none!',
								className
							)}
						>
							{children}
						</motion.div>
					</PopoverPrimitive.Content>
				</PopoverPrimitive.Portal>
			) : null}
		</AnimatePresence>
	);
}
