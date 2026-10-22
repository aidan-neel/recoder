'use client';

import { cn, DURATION, EASE_OUT, SPRING } from '@recoder/ui';
import { motion, useReducedMotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

/** Folded away: no height, faded out. */
const FOLDED = { height: 0, opacity: 0 };

/** Open at its own height. */
const SHOWN = { height: 'auto', opacity: 1 };

interface RevealProps {
	children: ReactNode;
	className?: string;
}

/**
 * Something that arrives or leaves inside a list (a provider row, a command
 * to run): it unfolds to its height and folds away again, so the rows around
 * it slide instead of jumping. Put it under an `AnimatePresence` with
 * `initial={false}`, so what is there on first paint stays still.
 */
export function Reveal({ children, className }: RevealProps) {
	const reduced = useReducedMotionConfig();

	return (
		<motion.div
			initial={FOLDED}
			animate={SHOWN}
			exit={FOLDED}
			transition={
				reduced ? { duration: 0 } : { height: SPRING, opacity: { duration: DURATION.toggle, ease: EASE_OUT } }
			}
			className={cn('overflow-hidden', className)}
		>
			{children}
		</motion.div>
	);
}
