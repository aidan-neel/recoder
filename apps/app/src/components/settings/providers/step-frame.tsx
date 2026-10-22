'use client';

import { DURATION, EASE_IN, EASE_OUT, SPRING, SPRING_SOFT } from '@recoder/ui';
import { AnimatePresence, motion, useReducedMotionConfig, type Variants } from 'motion/react';
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

/** How far a step travels as it slides in or out. */
const TRAVEL = 16;

/**
 * A step slides in from the side it comes from while it fades up through a
 * 2px blur; the old one slides the other way and fades out faster.
 */
const SLIDE: Variants = {
	enter: (direction: number) => ({ opacity: 0, x: TRAVEL * direction, filter: 'blur(2px)' }),
	center: {
		opacity: 1,
		x: 0,
		filter: 'blur(0px)',
		transition: { x: SPRING, default: { duration: DURATION.swap, ease: EASE_OUT } }
	},
	exit: (direction: number) => ({
		opacity: 0,
		x: -TRAVEL * direction,
		filter: 'blur(2px)',
		transition: { duration: DURATION.menuOut, ease: EASE_IN }
	})
};

/** The element's border-box height, kept current as it resizes; null before the first measure. */
function useBoxHeight(target: RefObject<HTMLElement | null>): number | null {
	const [height, setHeight] = useState<number | null>(null);

	useLayoutEffect(() => {
		const element = target.current;

		if (!element) return;

		const observer = new ResizeObserver((entries) => {
			const box = entries[0]?.borderBoxSize[0];

			if (box) setHeight(box.blockSize);
		});

		observer.observe(element);

		return () => observer.disconnect();
	}, [target]);

	return height;
}

interface StepFrameProps {
	/** Names the step on screen; a new name slides the new step in. */
	step: string;
	/** 1 slides the new step in from the right, -1 from the left. */
	direction: 1 | -1;
	children: ReactNode;
}

/**
 * The modal's body as it moves between steps: the steps cross in one cell
 * while the box springs to the new step's height, so the modal grows or
 * shrinks with them instead of jumping.
 */
export function StepFrame({ step, direction, children }: StepFrameProps) {
	const track = useRef<HTMLDivElement>(null);
	const height = useBoxHeight(track);
	const reduced = useReducedMotionConfig();

	return (
		<motion.div
			data-ui="provider-steps"
			initial={false}
			animate={{ height: height ?? 'auto' }}
			transition={reduced ? { duration: 0 } : SPRING_SOFT}
			className="provider-steps"
		>
			<div ref={track} className="provider-steps-track">
				<AnimatePresence initial={false} mode="popLayout" custom={direction}>
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
		</motion.div>
	);
}
