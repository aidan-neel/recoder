'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { swapMotion } from '../../motion/presets';
import { useMotionVariants } from '../../motion/reduced';

interface SwapTextProps {
	/** What is shown. A new `id` crossfades the new content in. */
	children: ReactNode;
	/**
	 * Names what is shown. Defaults to the text when `children` is a string or
	 * a number; other content never swaps without one.
	 */
	id?: string | number;
	/**
	 * `popLayout` (the default): old and new cross in one place, for one line
	 * that truncates. `wait`: the old leaves before the new comes in, for text
	 * that wraps, so two lines never overlap.
	 */
	mode?: 'popLayout' | 'wait';
	/**
	 * Shows each value for at least this long, in ms, so a burst of changes
	 * reads as calm swaps. The latest value always lands.
	 */
	holdMs?: number;
	/** Shows the full text on hover, for a line that truncates. */
	titled?: boolean;
	/** On the wrapper, which keeps its place in the layout while the text swaps. */
	className?: string;
	/** On the swapping text itself (a color, `inline-block`). */
	textClassName?: string;
}

/** What one swap shows: its key, its content and its hover title. */
interface Shown {
	key: string | number;
	children: ReactNode;
	title: string | undefined;
}

/**
 * The value, changing at most once per `holdMs`. A change waits until the
 * shown one has had its time, and only the latest pending one lands. New
 * content under the same key shows at once.
 */
function useHeld(value: Shown, holdMs: number): Shown {
	const [shown, setShown] = useState(value);
	const shownAt = useRef(0);
	const held = holdMs > 0 && !Object.is(value.key, shown.key);

	useEffect(() => {
		if (!held) return;

		const timer = setTimeout(
			() => {
				shownAt.current = Date.now();
				setShown(value);
			},
			Math.max(0, shownAt.current + holdMs - Date.now())
		);

		return () => clearTimeout(timer);
	}, [held, value, holdMs]);

	return held ? shown : value;
}

/**
 * Text that crossfades when it changes: the new text rises 2px out of a 2px
 * blur as the old one leaves (a plain fade under reduced motion). The first
 * paint never animates. The wrapper is positioned, so a one-line swap never
 * moves what sits around it.
 */
export function SwapText({
	children,
	id,
	mode = 'popLayout',
	holdMs = 0,
	titled = false,
	className,
	textClassName
}: SwapTextProps) {
	const variants = useMotionVariants(swapMotion);
	const text = typeof children === 'string' || typeof children === 'number' ? children : undefined;
	const key = id ?? text ?? 'content';
	const shown = useHeld({ key, children, title: titled && text !== undefined ? String(text) : undefined }, holdMs);

	return (
		<span data-ui="swap-text" className={cn('relative block min-w-0', className)}>
			<AnimatePresence initial={false} mode={mode}>
				<motion.span
					key={shown.key}
					title={shown.title}
					variants={variants}
					initial="initial"
					animate="animate"
					exit="exit"
					className={cn('block', mode === 'popLayout' && 'truncate', textClassName)}
				>
					{shown.children}
				</motion.span>
			</AnimatePresence>
		</span>
	);
}
