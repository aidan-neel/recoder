import { DURATION, EASE_OUT, SPRING } from '@recoder/ui';
import type { MotionProps } from 'motion/react';

/**
 * How a head or row of the queue list moves: it springs to a new place when
 * the list reorders, a new one fades in, and a closed one fades out. The
 * presence around the list skips all of it on first paint.
 */
export const LIST_ITEM_MOTION = {
	layout: 'position',
	transition: SPRING,
	initial: { opacity: 0 },
	animate: { opacity: 1, transition: { duration: DURATION.swap, ease: EASE_OUT } },
	exit: { opacity: 0, transition: { duration: DURATION.menuOut } }
} satisfies MotionProps;
