'use client';

import { DURATION, EASE_IN, EASE_OUT } from '@recoder/ui';
import { AnimatePresence, motion, useReducedMotionConfig, type Variants } from 'motion/react';
import type { ReactNode } from 'react';

/** How far a step travels as it slides in or out, in rem so it grows with the root font on large screens. */
const TRAVEL_REM = 0.75;

/**
 * A step slides in from the side it comes from as it fades up; the old one
 * leaves the other way, faster, so the two never read as a pair.
 */
const SLIDE: Variants = {
	enter: (direction: number) => ({ opacity: 0, x: `${TRAVEL_REM * direction}rem` }),
	center: { opacity: 1, x: '0rem', transition: { duration: DURATION.toggle, ease: EASE_OUT } },
	exit: (direction: number) => ({
		opacity: 0,
		x: `${-TRAVEL_REM * direction}rem`,
		transition: { duration: DURATION.menuOut, ease: EASE_IN }
	})
};

interface ProviderStepsProps {
	/** Names the step on screen; a new name brings the new step in. */
	step: string;
	/** 1 brings the new step in from the right, -1 from the left. */
	direction: 1 | -1;
	children: ReactNode;
}

/**
 * The dialog's body as it moves between steps. The steps cross in one cell
 * of a set height (`providers.css`), so the dialog and its footer stay put
 * from the list to a sign-in. Under reduced motion the steps swap at once.
 */
export function ProviderSteps({ step, direction, children }: ProviderStepsProps) {
	const reduced = useReducedMotionConfig();

	if (reduced) {
		return (
			<div className="provider-steps">
				<div key={step} className="provider-step">
					{children}
				</div>
			</div>
		);
	}

	return (
		<div className="provider-steps">
			<AnimatePresence initial={false} custom={direction}>
				<motion.div
					key={step}
					custom={direction}
					variants={SLIDE}
					initial="enter"
					animate="center"
					exit="exit"
					className="provider-step"
				>
					{children}
				</motion.div>
			</AnimatePresence>
		</div>
	);
}
