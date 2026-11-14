'use client';

import { AnimatePresence, motion } from 'motion/react';
import { HoverCard as HoverCardPrimitive } from 'radix-ui';
import { createContext, useContext, useState, type ReactElement, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { menuMotion } from '../../motion/presets';
import { useMotionVariants } from '../../motion/reduced';
import { PRESENCE } from './panel';

/** Whether the nearest hover card is open, so its panel stays mounted until the exit animation ends. */
const HoverCardOpen = createContext(false);

/** How long the pointer rests on the trigger before the card opens, and how long it may leave before it closes. */
const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 100;

interface HoverCardProps {
	/** Makes the card controlled, so the page can shut it, such as when its trigger is pressed. */
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	children: ReactNode;
}

/**
 * A card that opens when the pointer rests on its trigger (or keyboard focus
 * lands there) and stays while the pointer is on the trigger or the card, so
 * its text can be selected. For a preview of what the trigger points to;
 * anything that must be reached some other way too does not belong in it.
 */
export function HoverCard({ open: controlled, onOpenChange, children }: HoverCardProps) {
	const [own, setOwn] = useState(false);
	const open = controlled ?? own;

	/** Keeps the card's own state in step too, so it works the same with or without a controlling page. */
	function change(next: boolean): void {
		setOwn(next);
		onOpenChange?.(next);
	}

	return (
		<HoverCardOpen value={open}>
			<HoverCardPrimitive.Root open={open} onOpenChange={change} openDelay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS}>
				{children}
			</HoverCardPrimitive.Root>
		</HoverCardOpen>
	);
}

/** The element the card hangs from; it renders its child. */
export function HoverCardTrigger({ children }: { children: ReactElement }) {
	return <HoverCardPrimitive.Trigger asChild>{children}</HoverCardPrimitive.Trigger>;
}

interface HoverCardContentProps {
	side?: 'top' | 'right' | 'bottom' | 'left';
	align?: 'start' | 'center' | 'end';
	/** Gap between the trigger and the card, in px. */
	sideOffset?: number;
	className?: string;
	children?: ReactNode;
}

/** The floating card: the menu surface and the menus' short fade, flipping to stay 8px inside the viewport. */
export function HoverCardContent({
	side = 'bottom',
	align = 'start',
	sideOffset = 6,
	className,
	children
}: HoverCardContentProps) {
	const open = useContext(HoverCardOpen);
	const variants = useMotionVariants(menuMotion);

	return (
		<AnimatePresence>
			{open ? (
				<HoverCardPrimitive.Portal forceMount>
					<HoverCardPrimitive.Content
						forceMount
						asChild
						side={side}
						align={align}
						sideOffset={sideOffset}
						collisionPadding={8}
					>
						<motion.div
							{...PRESENCE}
							data-ui="hover-card-content"
							variants={variants}
							className={cn(
								'z-[130] max-w-(--radix-hover-card-content-available-width) origin-(--radix-hover-card-content-transform-origin)',
								'rounded-(--radius-card) bg-menu text-fg shadow-(--shadow-menu) outline-none',
								className
							)}
						>
							{children}
						</motion.div>
					</HoverCardPrimitive.Content>
				</HoverCardPrimitive.Portal>
			) : null}
		</AnimatePresence>
	);
}
