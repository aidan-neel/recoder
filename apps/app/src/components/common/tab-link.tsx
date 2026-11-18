'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentProps, MouseEvent } from 'react';

import { replaceSearch } from '@/lib/shell/navigation';

type TabLinkProps = Omit<ComponentProps<typeof Link>, 'href' | 'replace' | 'scroll' | 'prefetch'> & {
	href: string;
};

/** The path of an address, without its search params. */
function pathOf(href: string): string {
	return href.split('?')[0];
}

/** True for a click the browser would turn into a new tab or window, which the link must keep. */
function opensElsewhere(event: MouseEvent): boolean {
	return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/**
 * A link to another tab: it replaces the address and keeps the scroll. When
 * the tab is the page on screen with other search params (`?tab=bugs`), a
 * plain click swaps them in place with no server round trip, and the link is
 * never prefetched, since nothing would be fetched for it. A tab on another
 * path, such as a settings section, navigates like any link.
 */
export function TabLink({ href, onClick, ...props }: TabLinkProps) {
	const inPlace = pathOf(href) === usePathname();

	function switchInPlace(event: MouseEvent<HTMLAnchorElement>): void {
		onClick?.(event);

		if (event.defaultPrevented || opensElsewhere(event)) return;

		event.preventDefault();
		replaceSearch(href);
	}

	return (
		<Link
			{...props}
			href={href}
			replace
			scroll={false}
			prefetch={inPlace ? false : undefined}
			onClick={inPlace ? switchInPlace : onClick}
		/>
	);
}
