import type { Transition, Variants } from 'motion/react';

/**
 * The kit's motion language for JS animation, beside the `--dur-*` and
 * `--ease-menu` CSS tokens. Motion is for an everyday tool: menus, dialogs
 * and tooltips come and go quickly but visibly, and only movement that explains
 * a change (a row moving to its new group, a panel unfolding) eases.
 */
export const EASE_OUT = [0.2, 0.8, 0.2, 1] as const;

/** A gentle exit curve, for things leaving fast. */
export const EASE_IN = [0.32, 0, 0.67, 0] as const;

/**
 * Durations in seconds. Hover, toggle, swap and disclose match their
 * `--dur-*` tokens; the menu, modal and overlay timings live only here,
 * since overlays animate in JS.
 */
export const DURATION = {
	hover: 0.05,
	toggle: 0.18,
	swap: 0.14,
	disclose: 0.2,
	menuIn: 0.12,
	menuOut: 0.08,
	modalIn: 0.15,
	modalOut: 0.1,
	overlay: 0.12
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
 * Menus and popovers: a plain fade from a 0.97 scale in 120ms; out in 80ms.
 * No rise and no blur: the scale grows from the side the menu opens on, so it
 * reads the same whether the menu drops down or opens upward.
 */
export const menuMotion: Variants = {
	closed: { opacity: 0, scale: 0.97, transition: { duration: DURATION.menuOut, ease: EASE_IN } },
	open: { opacity: 1, scale: 1, transition: { duration: DURATION.menuIn, ease: EASE_OUT } }
};

/** Modals: the same entrance as menus, a touch longer (150ms in, 100ms out). */
export const modalMotion: Variants = {
	closed: { opacity: 0, scale: 0.97, transition: { duration: DURATION.modalOut, ease: EASE_IN } },
	open: { opacity: 1, scale: 1, transition: { duration: DURATION.modalIn, ease: EASE_OUT } }
};

/** The scrim behind a modal fades only. */
export const scrimMotion: Variants = {
	closed: { opacity: 0, transition: { duration: DURATION.modalOut } },
	open: { opacity: 1, transition: { duration: DURATION.overlay } }
};

/**
 * A label or panel that swaps in place crossfades with a 2px rise (140ms in,
 * 80ms out). No blur: swaps run on every decision, and a blur repaints the
 * text each frame. Only the status glyph blurs.
 */
export const swapMotion: Variants = {
	initial: { opacity: 0, y: 2 },
	animate: { opacity: 1, y: 0, transition: { duration: DURATION.swap, ease: EASE_OUT } },
	exit: { opacity: 0, y: -2, transition: { duration: DURATION.menuOut, ease: EASE_IN } }
};
