'use client';

import { useSyncExternalStore } from 'react';

import { narrowQuery, sidebarShown, useChrome } from './chrome';

/** Follows the window crossing the drawer's width. */
function subscribe(notify: () => void): () => void {
	const query = narrowQuery();

	query?.addEventListener('change', notify);

	return () => query?.removeEventListener('change', notify);
}

/** True on a window narrow enough that the sidebar is a drawer. False on the server, so the first paint matches. */
function useNarrow(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => narrowQuery()?.matches ?? false,
		() => false
	);
}

/** True while the sidebar is on screen, as a column beside the page or as an open drawer over it. */
export function useSidebarShown(): boolean {
	const narrow = useNarrow();

	return useChrome((state) => sidebarShown(state, narrow));
}
