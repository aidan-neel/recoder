'use client';

import type { ComponentProps, MouseEvent } from 'react';

import { leavesApp, navigate } from '@/lib/shell/navigation';

export type LinkProps = Omit<ComponentProps<'a'>, 'href'> & { href: string };

/** True for a click the browser would turn into a new tab or window, which the link must keep. */
function opensElsewhere(event: MouseEvent): boolean {
	return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/**
 * True for a click the app answers itself. One that was already handled, one
 * that opens a new tab, and one to an address outside this shell stay with
 * the browser.
 */
export function staysInApp(event: MouseEvent, href: string): boolean {
	return !event.defaultPrevented && !opensElsewhere(event) && !leavesApp(href);
}

/**
 * A link to another page of the app. It is a real anchor, so a new tab, a
 * copied address and the keyboard all work; a plain click changes the page
 * in the browser, in the same frame.
 */
export function Link({ href, onClick, ...props }: LinkProps) {
	function follow(event: MouseEvent<HTMLAnchorElement>): void {
		onClick?.(event);

		if (!staysInApp(event, href)) return;

		event.preventDefault();
		navigate(href);
	}

	return <a {...props} href={href} onClick={follow} />;
}
