'use client';

import { useSyncExternalStore } from 'react';

/** The root font size over 16px: 1 at most widths, more at 1920px and 2400px, where every CSS px (compiled to rem) grows. */
export function rootScale(): number {
	return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;
}

/** The root font size follows the window width, so a resize can change it. */
function subscribe(notify: () => void): () => void {
	window.addEventListener('resize', notify);

	return () => window.removeEventListener('resize', notify);
}

/** The root font scale, for px sizes in JS that must match CSS px. 1 on the server. */
export function useRootScale(): number {
	return useSyncExternalStore(subscribe, rootScale, () => 1);
}
