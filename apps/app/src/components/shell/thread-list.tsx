'use client';

import { DURATION, EASE_OUT } from '@recoder/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

/** The list's gap between rows, in px (`.thread-list`): a leaving row gives it up as it folds, so nothing snaps. */
const GAP = 2;

const FOLDED = { height: 0, opacity: 0, marginBottom: -GAP };
const OPEN = { height: 'auto', opacity: 1, marginBottom: 0 };

/**
 * A list of thread rows whose rows fold away when they leave it (settled or deleted) and unfold when they come back,
 * so the rows around them glide instead of jumping. The rows it starts with draw at once.
 */
export function ThreadList({ children }: { children: ReactNode }) {
	return (
		<div className="thread-list">
			<AnimatePresence initial={false}>{children}</AnimatePresence>
		</div>
	);
}

/** One row of a `ThreadList`, keyed by the row's id. Under reduced motion it comes and goes at once. */
export function ThreadItem({ children }: { children: ReactNode }) {
	const still = useReducedMotion();

	return (
		<motion.div
			className="thread-item"
			initial={FOLDED}
			animate={OPEN}
			exit={FOLDED}
			transition={still ? { duration: 0 } : { duration: DURATION.disclose, ease: EASE_OUT }}
		>
			{children}
		</motion.div>
	);
}
