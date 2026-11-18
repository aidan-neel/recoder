'use client';

import type { MouseEvent } from 'react';

import { replaceAddress } from '@/lib/shell/navigation';

import { staysInApp, type LinkProps } from './link';

/**
 * A link to another tab, or to a place on one: it replaces the address, so
 * Back leaves the page instead of walking through its tabs, and the page
 * keeps its scroll.
 */
export function TabLink({ href, onClick, ...props }: LinkProps) {
	function switchTab(event: MouseEvent<HTMLAnchorElement>): void {
		onClick?.(event);

		if (!staysInApp(event, href)) return;

		event.preventDefault();
		replaceAddress(href);
	}

	return <a {...props} href={href} onClick={switchTab} />;
}
