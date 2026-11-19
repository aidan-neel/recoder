import type { Transition, Variants } from 'motion/react';

/**
 * The site's motion language. recoder.dev is a showcase, so its docs move
 * more than the app does: things travel and unfold on springs with a little
 * give, and lists arrive one row after another. Two springs and one stagger
 * carry all of it. The CSS side (`styles/motion.css`) holds the same
 * springs as `linear()` curves, generated from these with motion's
 * `spring(visualDuration, bounce)`, so a CSS transition and a JS one land
 * alike. The visitor's reduced-motion setting turns movement off
 * (`MotionRoot`, `motion.css`).
 */

/** What travels between items (the active page's fill): it overshoots a touch and settles. */
export const TRAVEL: Transition = { type: 'spring', visualDuration: 0.4, bounce: 0.25 };

/** How long after a page change the other pages fold: about when the travelling fill has landed. */
export const HANDOFF_MS = 320;

/** What unfolds (a section list's height): softer than travel, so a long list never wobbles. */
const UNFOLD: Transition = { type: 'spring', visualDuration: 0.45, bounce: 0.1 };

/** How far apart the rows of an unfolding list start, in seconds. */
const STAGGER = 0.025;

/**
 * A sidebar list opening and closing: the height on the unfold spring, the
 * fade over most of it, so a closing list stays legible until it has nearly
 * shut, and the rows one after another.
 */
export const SECTION_UNFOLD: Transition = {
	height: UNFOLD,
	opacity: { duration: 0.32, ease: 'easeInOut' },
	staggerChildren: STAGGER,
	delayChildren: 0.04
};

/** One row of an unfolding list: it rises 6px into place as it fades in, and sinks back as the list closes. */
export const ROW: Variants = {
	collapsed: { opacity: 0, y: -6, transition: { duration: 0.2, ease: 'easeIn' } },
	expanded: { opacity: 1, y: 0, transition: TRAVEL }
};
