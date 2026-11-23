'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

/** Nothing to subscribe to: whether this is the browser never changes after the first render. */
function subscribe(): () => void {
	return () => {};
}

/**
 * The app renders in the browser only: it talks to the review server on this
 * machine and reads the theme, the sidebar and viewed files from local
 * storage, so a server render would paint a frame that changes on load. The
 * server and the hydrating render both paint nothing; the page takes over
 * right after, fully formed.
 */
export function ClientRoot({ children }: { children: ReactNode }) {
	const browser = useSyncExternalStore(
		subscribe,
		() => true,
		() => false
	);

	return browser ? children : null;
}
