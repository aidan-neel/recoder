'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

import { AppShell } from './app-shell';

/** Nothing to subscribe to: whether this is the browser never changes after the first render. */
function subscribe(): () => void {
	return () => {};
}

/**
 * The app renders in the browser only: it talks to the review server on this
 * machine and reads tabs, decisions and the theme from local storage, so a
 * server render would only paint a shell that changes on load. The server and
 * the hydrating render both paint nothing; the shell takes over right after.
 * It ships in this chunk, so no second request stands before the first paint.
 */
export function ClientRoot({ children }: { children: ReactNode }) {
	const browser = useSyncExternalStore(
		subscribe,
		() => true,
		() => false
	);

	return browser ? <AppShell>{children}</AppShell> : null;
}
