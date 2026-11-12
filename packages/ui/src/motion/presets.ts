import type { Transition, Variants } from 'motion/react';

/**
 * The kit's motion language for JS animation, beside the `--dur-*` and
 * `--ease-menu` CSS tokens. Motion is for an everyday tool: feedback is
 * quick, and only movement that explains a change (a pill sliding to the
 * active tab, a row moving to its new group) eases.
 */
export const EASE_OUT = [0.2, 0.8, 0.2, 1] as const;

/** The curve a sliding pill or highlight travels on. */
export const EASE_PILL = [0.3, 0.7, 0.2, 1] as const;

/** A gentle exit curve, for things leaving fast. */
export const EASE_IN = [0.32, 0, 0.67, 0] as const;

/**
 * Durations in seconds. Hover, toggle, swap, pill and disclose match their
 * `--dur-*` tokens; the menu, modal and overlay timings live only here,
 * since overlays animate in JS.
 */
export const DURATION = {
	hover: 0.1,
	toggle: 0.18,
	swap: 0.14,
	pill: 0.24,
	disclose: 0.2,
	menuIn: 0.13,
	menuOut: 0.08,
	modalIn: 0.15,
	modalOut: 0.07,
	overlay: 0.12
} as const;

/**
 * A tight spring for layout moves (pills, highlights, rows changing place).
 * Critically damped (zeta 1.0), so it never overshoots and keeps its velocity
 * when retargeted mid-move. Measured with motion's spring: a 100px move lands
 * within 0.5px in 233ms and comes to rest at 302ms; a 20px move within 0.5px
 * in 175ms.
 */
export const SPRING: Transition = { type: 'spring', stiffness: 1000, damping: 63, mass: 1 };

/**
 * A softer spring for larger surfaces that resize or move across the page.
 * Critically damped (zeta 1.0): a 100px move lands within 0.5px in 345ms and
 * comes to rest at 427ms.
 */
export const SPRING_SOFT: Transition = { type: 'spring', stiffness: 380, damping: 35, mass: 0.8 };

/**
 * Menus and popovers: fade, 0.95 scale and a 2px blur in 130ms; out in 80ms.
 * No rise: the scale grows from the side the menu opens on, so it reads the
 * same whether the menu drops down or opens upward.
 */
export const menuMotion: Variants = {
	closed: { opacity: 0, scale: 0.95, filter: 'blur(2px)', transition: { duration: DURATION.menuOut, ease: EASE_IN } },
	open: { opacity: 1, scale: 1, filter: 'blur(0px)', transition: { duration: DURATION.menuIn, ease: EASE_OUT } }
};

/** Modals: the same entrance as menus, a touch longer (150ms in, 70ms out). */
export const modalMotion: Variants = {
	closed: { opacity: 0, scale: 0.95, filter: 'blur(2px)', transition: { duration: DURATION.modalOut, ease: EASE_IN } },
	open: { opacity: 1, scale: 1, filter: 'blur(0px)', transition: { duration: DURATION.modalIn, ease: EASE_OUT } }
};

/** The scrim behind a modal fades only. */
export const scrimMotion: Variants = {
	closed: { opacity: 0, transition: { duration: DURATION.modalOut } },
	open: { opacity: 1, transition: { duration: DURATION.overlay } }
};

/**
 * A label or panel that swaps in place crossfades with a 2px rise (140ms in,
 * 80ms out). No blur: swaps run on every decision, and a blur repaints the
 * text each frame. Only menus, modals, the palette and the status glyph blur.
 */
export const swapMotion: Variants = {
	initial: { opacity: 0, y: 2 },
	animate: { opacity: 1, y: 0, transition: { duration: DURATION.swap, ease: EASE_OUT } },
	exit: { opacity: 0, y: -2, transition: { duration: DURATION.menuOut, ease: EASE_IN } }
};
