'use client';

import { useReducedMotionConfig, type Variants } from 'motion/react';

/** Fade-only copies of the presets, made once per preset so their identity stays stable across renders. */
const faded = new WeakMap<Variants, Variants>();

/** The resting value of each moving property the presets use: no offset, full size, no blur. */
const STILL: Record<string, number | string> = { x: 0, y: 0, scale: 1, filter: 'blur(0px)' };

/**
 * Keeps the opacity and timing of each variant and holds every moving
 * property at rest: what reduced motion leaves of an entrance or a swap. The
 * resting values stay in every variant, in the preset's order, so a first
 * paint renders the same style as the full preset and a server-rendered swap
 * hydrates cleanly.
 */
function fadeOnly(variants: Variants): Variants {
	const cached = faded.get(variants);

	if (cached) return cached;

	const fade: Variants = {};

	for (const [name, variant] of Object.entries(variants)) {
		if (typeof variant === 'function') {
			fade[name] = variant;

			continue;
		}

		const kept = Object.entries(variant).flatMap(([key, value]) => {
			if (key in STILL) return [[key, STILL[key]]];

			return key === 'opacity' || key === 'transition' ? [[key, value]] : [];
		});

		fade[name] = Object.fromEntries(kept);
	}

	faded.set(variants, fade);

	return fade;
}

/**
 * The variants to animate with. Under reduced motion (the shell's
 * `MotionConfig`, or the system setting) a preset keeps only its fade: no
 * scale, rise or blur, so nothing snaps to its size when the fade ends.
 */
export function useMotionVariants(variants: Variants): Variants {
	return useReducedMotionConfig() ? fadeOnly(variants) : variants;
}
