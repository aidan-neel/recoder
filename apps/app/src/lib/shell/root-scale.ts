'use client';

import { useSyncExternalStore } from 'react';

/** The root font size over 16px: 1 unless the browser's default font size was changed, which every CSS px (compiled to rem) follows. */
function rootScale(): number {
	return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;
}

/** A browser zoom or font setting can change the root size; both fire a resize. */
function subscribe(notify: () => void): () => void {
	window.addEventListener('resize', notify);

	return () => window.removeEventListener('resize', notify);
}

/** The root font scale, for px sizes in JS that must match CSS px. 1 on the server. */
export function useRootScale(): number {
	return useSyncExternalStore(subscribe, rootScale, () => 1);
}
