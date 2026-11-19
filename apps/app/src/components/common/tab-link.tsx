'use client';

import { replaceAddress } from '@/lib/shell/navigation';

import { followLink, type LinkProps } from './link';

/**
 * A link to another tab, or to a place on one: it replaces the address, so
 * Back leaves the page instead of walking through its tabs, and the page
 * keeps its scroll. A Cmd, Ctrl or middle click opens it in a new window tab.
 */
export function TabLink({ href, onClick, onAuxClick, ...props }: LinkProps) {
	return (
		<a
			{...props}
			href={href}
			onClick={(event) => {
				onClick?.(event);
				followLink(event, href, replaceAddress);
			}}
			onAuxClick={(event) => {
				onAuxClick?.(event);
				followLink(event, href, replaceAddress);
			}}
		/>
	);
}
