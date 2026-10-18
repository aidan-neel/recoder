'use client';

import { AnimatePresence, motion, type Variants } from 'motion/react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import {
	createContext,
	useContext,
	useEffect,
	useState,
	type ComponentProps,
	type FocusEvent,
	type FocusEventHandler,
	type ReactElement,
	type ReactNode
} from 'react';

import { DURATION, EASE_IN, EASE_OUT } from '../../motion/presets';
import { useMotionVariants } from '../../motion/reduced';
import { Keycap } from '../keycap';
import { PRESENCE } from './panel';

/** True under a `TooltipProvider`; a tooltip outside one brings its own. */
const Provided = createContext(false);

/** Whether the person's last input was a key press rather than a pointer press. */
let keyboardLast = false;

/**
 * Follows the last input, for `keyboardFocusOnly`. `:focus-visible` cannot
 * tell: a menu opened by a click focuses itself from script, and Chrome then
 * marks that focus, and the trigger's when it comes back, as visible.
 */
function trackInput(): () => void {
	const key = () => (keyboardLast = true);
	const pointer = () => (keyboardLast = false);

	document.addEventListener('keydown', key, true);
	document.addEventListener('pointerdown', pointer, true);

	return () => {
		document.removeEventListener('keydown', key, true);
		document.removeEventListener('pointerdown', pointer, true);
	};
}

/** A short fade with a 0.96 scale: lighter than a menu, since tooltips come and go as the pointer travels. */
const tooltipMotion: Variants = {
	closed: { opacity: 0, scale: 0.96, transition: { duration: DURATION.menuOut, ease: EASE_IN } },
	open: { opacity: 1, scale: 1, transition: { duration: DURATION.hover, ease: EASE_OUT } }
};

/**
 * Shares the open delay across tooltips: the first shows after 125ms, and
 * moving to a neighbor within 300ms shows it at once. Mount it once near the
 * root of the app.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
	useEffect(trackInput, []);

	return (
		<Provided value>
			<TooltipPrimitive.Provider delayDuration={125} skipDelayDuration={300} disableHoverableContent>
				{children}
			</TooltipPrimitive.Provider>
		</Provided>
	);
}

interface TooltipProps extends Omit<
	ComponentProps<typeof TooltipPrimitive.Trigger>,
	'asChild' | 'children' | 'content'
> {
	content: ReactNode;
	/** A key name (`mod+k`, `j`, `?`) printed as a keycap after the text. */
	shortcut?: string;
	side?: 'top' | 'bottom' | 'left' | 'right';
	/** The trigger. It must hold a ref and take pointer events, so wrap a disabled button in a span. */
	children: ReactElement;
}

/**
 * A small label for a control, shown on hover and keyboard focus. Pressing
 * the trigger hides it until the pointer leaves, and Escape dismisses it.
 * Focus handed back after a pointer pick in a menu or dialog does not show it.
 * Props from a wrapping trigger (a `DropdownMenuTrigger`) pass through to the
 * child, so the two compose in either order.
 */
export function Tooltip(props: TooltipProps) {
	const provided = useContext(Provided);

	if (provided) return <Bubble {...props} />;

	return (
		<TooltipProvider>
			<Bubble {...props} />
		</TooltipProvider>
	);
}

/**
 * Lets focus open the bubble only after a key press. A menu or dialog closed
 * with the pointer hands focus back to its trigger, and the bubble then stays
 * shut instead of staying open, away from the pointer, until focus moves on.
 */
function keyboardFocusOnly(onFocus?: FocusEventHandler<HTMLButtonElement>): FocusEventHandler<HTMLButtonElement> {
	return (event: FocusEvent<HTMLButtonElement>) => {
		onFocus?.(event);

		if (!keyboardLast) event.preventDefault();
	};
}

/** The trigger and its bubble. Open state lives here so the bubble can animate out before it unmounts. */
function Bubble({ content, shortcut, side = 'top', children, onFocus, ...trigger }: TooltipProps) {
	const [open, setOpen] = useState(false);
	const variants = useMotionVariants(tooltipMotion);

	return (
		<TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
			<TooltipPrimitive.Trigger asChild {...trigger} onFocus={keyboardFocusOnly(onFocus)}>
				{children}
			</TooltipPrimitive.Trigger>
			<AnimatePresence>
				{open ? (
					<TooltipPrimitive.Portal forceMount>
						<TooltipPrimitive.Content forceMount asChild side={side} sideOffset={6} collisionPadding={8}>
							<motion.div
								{...PRESENCE}
								data-ui="tooltip"
								variants={variants}
								className="pointer-events-none z-[140] flex max-w-[18rem] origin-(--radix-tooltip-content-transform-origin) items-center gap-2 rounded-[8px] bg-menu px-2 py-[5px] text-[12px] leading-4 font-normal text-pretty text-fg shadow-(--shadow-menu) select-none"
							>
								<span>{content}</span>
								{shortcut ? <Keycap k={shortcut} /> : null}
							</motion.div>
						</TooltipPrimitive.Content>
					</TooltipPrimitive.Portal>
				) : null}
			</AnimatePresence>
		</TooltipPrimitive.Root>
	);
}
