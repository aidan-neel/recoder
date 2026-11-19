'use client';

import type { ComponentProps, MouseEvent } from 'react';

import { leavesApp, navigate, openTab } from '@/lib/shell/navigation';

export type LinkProps = Omit<ComponentProps<'a'>, 'href'> & { href: string };

/** True for a press that opens the link in a new tab of the app's window: Cmd or Ctrl held, or the middle button. */
function opensTab(event: MouseEvent): boolean {
	const button = event.button === 1 || (event.button === 0 && (event.metaKey || event.ctrlKey));

	return button && !event.shiftKey && !event.altKey;
}

/**
 * Follows a click on a link to a page of the app. Cmd, Ctrl or the middle button open it in a new tab of the window,
 * on screen; a plain click goes there with `go` in the tab on screen. A click that was already handled, one the
 * browser keeps (Shift for a new window, Alt to download) and one to an address outside this shell stay with the
 * browser.
 */
export function followLink(event: MouseEvent, href: string, go: (href: string) => void): void {
	if (event.defaultPrevented || leavesApp(href)) return;

	if (opensTab(event)) {
		event.preventDefault();
		openTab(href);

		return;
	}

	if (event.button !== 0 || event.shiftKey || event.altKey) return;

	event.preventDefault();
	go(href);
}

/**
 * A link to another page of the app. It is a real anchor, so a copied address and the keyboard work; a plain click
 * changes the page in the tab on screen, in the same frame, and a Cmd, Ctrl or middle click opens a new tab.
 */
export function Link({ href, onClick, onAuxClick, ...props }: LinkProps) {
	return (
		<a
			{...props}
			href={href}
			onClick={(event) => {
				onClick?.(event);
				followLink(event, href, navigate);
			}}
			onAuxClick={(event) => {
				onAuxClick?.(event);
				followLink(event, href, navigate);
			}}
		/>
	);
}
