import type { Transition, Variants } from 'motion/react';

/**
 * The kit's motion language for JS animation, beside the `--dur-*` and
 * `--ease-menu` CSS tokens. Motion is for an everyday tool: menus, dialogs
 * and tooltips come and go quickly but visibly, and only movement that explains
 * a change (a row moving to its new group, a panel unfolding) eases. One
 * strong ease-out curve serves entrances and exits alike: an exit on it
 * clears most of the way in its first frames, so nothing lingers.
 */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/**
 * Durations in seconds. Hover, toggle, swap and disclose match their
 * `--dur-*` tokens; the menu, modal and overlay timings live only here,
 * since overlays animate in JS.
 */
export const DURATION = {
	hover: 0.08,
	toggle: 0.21,
	swap: 0.17,
	disclose: 0.23,
	menuIn: 0.18,
	menuOut: 0.15,
	modalIn: 0.18,
	modalOut: 0.13,
	overlay: 0.15
} as const;

/**
 * A tight spring for layout moves (highlights, rows changing place, a list
 * resizing). Critically damped (zeta 1.0), so it never overshoots and keeps
 * its velocity when retargeted mid-move. Measured with motion's spring: a
 * 100px move lands within 0.5px in 233ms and comes to rest at 302ms; a 20px
 * move within 0.5px in 175ms.
 */
export const SPRING: Transition = { type: 'spring', stiffness: 1000, damping: 63, mass: 1 };

/**
 * A softer spring for larger surfaces that resize or move across the page.
 * Critically damped (zeta 1.0): a 100px move lands within 0.5px in 345ms and
 * comes to rest at 427ms.
 */
export const SPRING_SOFT: Transition = { type: 'spring', stiffness: 380, damping: 35, mass: 0.8 };

/**
 * Menus and popovers: a plain fade from a 0.97 scale in 180ms; out in 150ms.
 * No rise and no blur: the scale grows from the side the menu opens on, so it
 * reads the same whether the menu drops down or opens upward.
 */
export const menuMotion: Variants = {
	closed: { opacity: 0, scale: 0.97, transition: { duration: DURATION.menuOut, ease: EASE_OUT } },
	open: { opacity: 1, scale: 1, transition: { duration: DURATION.menuIn, ease: EASE_OUT } }
};

/** Modals: the same entrance as menus (180ms in, 130ms out). */
export const modalMotion: Variants = {
	closed: { opacity: 0, scale: 0.97, transition: { duration: DURATION.modalOut, ease: EASE_OUT } },
	open: { opacity: 1, scale: 1, transition: { duration: DURATION.modalIn, ease: EASE_OUT } }
};

/** The scrim behind a modal fades only. */
export const scrimMotion: Variants = {
	closed: { opacity: 0, transition: { duration: DURATION.modalOut } },
	open: { opacity: 1, transition: { duration: DURATION.overlay } }
};

/**
 * A label or panel that swaps in place crossfades with a 2px rise (170ms in,
 * 150ms out). No blur: swaps run on every decision, and a blur repaints the
 * text each frame. Only the status glyph blurs.
 */
export const swapMotion: Variants = {
	initial: { opacity: 0, y: 2 },
	animate: { opacity: 1, y: 0, transition: { duration: DURATION.swap, ease: EASE_OUT } },
	exit: { opacity: 0, y: -2, transition: { duration: DURATION.menuOut, ease: EASE_OUT } }
};
