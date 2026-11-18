'use client';

import { useMemo, useSyncExternalStore } from 'react';

import { SAMPLE_HREF } from './routes';

/**
 * Where the app is, read from the browser's own address. The app renders in
 * the browser only, so a page change is a history entry and a render: no
 * request to the server that serves the app, in development or production.
 * Next patches the history calls and keeps its own router on the same
 * address, so back, forward and a reload behave as on any page.
 */

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	window.addEventListener('popstate', listener);

	return () => {
		listeners.delete(listener);
		window.removeEventListener('popstate', listener);
	};
}

/** Tells every reader the address changed; the history calls fire no event of their own. */
function announce(): void {
	for (const listener of [...listeners]) listener();
}

/** True for a path of the sample, which has its own shell and client. */
function inSample(pathname: string): boolean {
	return pathname === SAMPLE_HREF || pathname.startsWith(`${SAMPLE_HREF}/`);
}

/**
 * True for an address the shell on screen cannot show: another site, or the
 * other side of the line between the live app and the sample. The browser
 * loads those.
 */
export function leavesApp(href: string): boolean {
	const target = new URL(href, window.location.href);

	return target.origin !== window.location.origin || inSample(target.pathname) !== inSample(window.location.pathname);
}

/** Goes to a page: the screen for it renders at once, and Back returns here. */
export function navigate(href: string): void {
	if (leavesApp(href)) {
		window.location.assign(href);

		return;
	}

	const target = new URL(href, window.location.href);

	if (target.href === window.location.href) return;

	window.history.pushState(null, '', target);
	announce();
}

/** Swaps the address in place, such as for another tab or a redirect: Back skips the one it replaced. */
export function replaceAddress(href: string): void {
	if (leavesApp(href)) {
		window.location.replace(href);

		return;
	}

	window.history.replaceState(null, '', href);
	announce();
}

/** The path of the address on screen. */
export function usePathname(): string {
	return useSyncExternalStore(
		subscribe,
		() => window.location.pathname,
		() => '/'
	);
}

/** The search params of the address on screen. */
export function useSearchParams(): URLSearchParams {
	const search = useSyncExternalStore(
		subscribe,
		() => window.location.search,
		() => ''
	);

	return useMemo(() => new URLSearchParams(search), [search]);
}
