'use client';

import { DURATION, EASE_OUT, SPRING } from '@recoder/ui';
import { motion, useIsPresent, usePresenceData, type TargetAndTransition, type Transition } from 'motion/react';
import { useRef, type ReactNode } from 'react';

/**
 * Width springs like every layout move; the fade is quicker, so a leaving
 * piece is gone before it closes up. The fade runs through `--grow-fade`
 * (shell.css applies it) rather than `opacity`, which would trap a tab's
 * pill in its own layer and lift it over the labels it slides past.
 */
const TRANSITION: Transition = { width: SPRING, '--grow-fade': { duration: DURATION.swap, ease: EASE_OUT } };

/** Leaving on the spring, so the neighbors close up. */
const COLLAPSE: TargetAndTransition = { width: 0, '--grow-fade': 0 };

/** Leaving at once: shell.css takes the piece out of the row in the same commit (`data-gone`). */
const GONE: TargetAndTransition = { ...COLLAPSE, transition: { duration: 0 } };

interface GrowProps {
	/**
	 * Holds the pill. It arrives at full size, so the pill sliding to it is
	 * not clipped, and if it leaves (its tab closed) it goes at once, so the
	 * pill lands on a tab already in place.
	 */
	lead?: boolean;
	children: ReactNode;
}

/**
 * A piece of the top bar that grows in from nothing and collapses away,
 * so its neighbors reflow instead of jumping. Use it inside an
 * `AnimatePresence initial={false}`, so what is there on first paint just
 * sits. The gap before it lives inside it (`--grow-gap` in shell.css), so a
 * collapsed piece leaves no gap behind. It clips only while it moves, so
 * focus rings show at rest.
 *
 * It leaves at once when the presence list passes `custom={true}` (the bar
 * is swapping pieces) or when it holds the pill. Then it is out of the row
 * before the pill measures where it is going, so the pill never chases a
 * tab while the bar reflows. Grow inherits no labels, so a piece inside a
 * leaving tab (its count) is left alone.
 */
export function Grow({ lead, children }: GrowProps) {
	const ref = useRef<HTMLSpanElement>(null);
	const present = useIsPresent();
	const swapping = usePresenceData() === true;
	const gone = !present && (swapping || !!lead);

	return (
		<motion.span
			ref={ref}
			data-ui="grow"
			data-gone={gone || undefined}
			initial={lead ? false : { width: 0, '--grow-fade': 0 }}
			animate={{ width: 'auto', '--grow-fade': 1 }}
			inherit={false}
			exit={gone ? GONE : COLLAPSE}
			transition={TRANSITION}
			onAnimationStart={() => ref.current?.setAttribute('data-moving', '')}
			onAnimationComplete={() => ref.current?.removeAttribute('data-moving')}
		>
			<span data-ui="grow-body">{children}</span>
		</motion.span>
	);
}
