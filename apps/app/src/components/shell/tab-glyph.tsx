'use client';

import { Spinner, swapMotion, useMotionVariants } from '@recoder/ui';
import { GitPullRequest } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

/**
 * A review tab's mark: a spinner while the review runs, then the pull
 * request icon. A finished review crossfades from one to the other; the
 * first paint does not animate.
 */
export function TabGlyph({ running }: { running: boolean }) {
	const swap = useMotionVariants(swapMotion);

	return (
		<span data-ui="tab-glyph" data-running={running || undefined} aria-hidden>
			<AnimatePresence initial={false}>
				<motion.span
					key={running ? 'running' : 'done'}
					data-ui="tab-glyph-face"
					variants={swap}
					initial="initial"
					animate="animate"
					exit="exit"
				>
					{running ? <Spinner size={12} /> : <GitPullRequest size={13} strokeWidth={1.75} />}
				</motion.span>
			</AnimatePresence>
		</span>
	);
}
