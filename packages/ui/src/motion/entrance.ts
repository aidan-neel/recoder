'use client';

import { useState, type AnimationEvent } from 'react';

/** How a block arrives: whole (`block`), or its children one after another (`stagger`). See `styles/kit-motion.css`. */
export type EntranceKind = 'block' | 'stagger';

/** The props that give a block its entrance. Spread them on the block itself. */
export interface EntranceProps {
	'data-enter': EntranceKind | undefined;
	onAnimationEnd: (event: AnimationEvent<HTMLElement>) => void;
}

/** The keyframes `kit-motion.css` plays for an entrance, with and without movement. */
const ENTRANCE_NAMES = new Set(['ui-enter', 'ui-enter-fade']);

/** Whether an animation is one of the kit's entrances. */
function isEntrance(animation: Animation): boolean {
	return animation instanceof CSSAnimation && ENTRANCE_NAMES.has(animation.animationName);
}

/**
 * The entrance for a block's first reveal only. It plays when the block mounts
 * and is taken off once everything in it has arrived, so rows that a filter or
 * a refresh brings back later appear at once, as any list's do. Keep the hook
 * in a component that outlives the block's remounts when those should not
 * replay it either.
 */
export function useEntrance(kind: EntranceKind): EntranceProps {
	const [entering, setEntering] = useState(true);

	function onAnimationEnd(event: AnimationEvent<HTMLElement>): void {
		const arriving = event.currentTarget.getAnimations({ subtree: true }).some(isEntrance);

		if (!arriving) setEntering(false);
	}

	return { 'data-enter': entering ? kind : undefined, onAnimationEnd };
}
