'use client';

import { Spinner, swapMotion, useMotionVariants } from '@recoder/ui';
import { GitPullRequest } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { memo } from 'react';

/** The mark itself: a spinner while the review runs, then the pull request icon. */
function GlyphIcon({ running }: { running: boolean }) {
	return running ? <Spinner size={12} /> : <GitPullRequest size={13} strokeWidth={1.75} />;
}

/** The mark that crossfades when the review finishes; the first paint does not animate. */
function GlyphSwap({ running }: { running: boolean }) {
	const swap = useMotionVariants(swapMotion);

	return (
		<AnimatePresence initial={false}>
			<motion.span
				key={running ? 'running' : 'done'}
				data-ui="tab-glyph-face"
				variants={swap}
				initial="initial"
				animate="animate"
				exit="exit"
			>
				<GlyphIcon running={running} />
			</motion.span>
		</AnimatePresence>
	);
}

interface TabGlyphProps {
	running: boolean;
	/** Draws the mark with no motion, for the hidden row the bar measures and the boot bar. */
	still?: boolean;
}

/**
 * A review tab's mark: a spinner while the review runs, then the pull
 * request icon. A finished review crossfades from one to the other. It
 * renders again only when the review starts or stops running.
 */
export const TabGlyph = memo(function TabGlyph({ running, still }: TabGlyphProps) {
	return (
		<span data-ui="tab-glyph" data-running={running || undefined} aria-hidden>
			{still ? (
				<span data-ui="tab-glyph-face">
					<GlyphIcon running={running} />
				</span>
			) : (
				<GlyphSwap running={running} />
			)}
		</span>
	);
});
