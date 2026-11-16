'use client';

import { NavPill } from '@recoder/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { MouseEvent } from 'react';

import { replaceSearch } from '@/lib/shell/navigation';

/** One tab of a page: a link with its own address. */
export interface PageTab {
	id: string;
	label: string;
	href: string;
	/** A number after the label (files, open bugs). Null or zero shows none. */
	count?: number | null;
	/** `bugs` colors the count as a warning. */
	tone?: 'bugs';
}

interface PageTabsProps {
	/** What the tabs move between, for a screen reader: "Pull request", "Settings". */
	label: string;
	tabs: readonly PageTab[];
	/** The open tab's id. */
	current: string;
}

/** The path of a tab's address, without its search params. */
function pathOf(href: string): string {
	return href.split('?')[0];
}

/** True for a click the browser would turn into a new tab or window, which the link must keep. */
function opensElsewhere(event: MouseEvent): boolean {
	return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/**
 * A page's tabs as links, so each has an address and opens in a new browser
 * tab like any link. The open one sits on a fill. A tab that only changes the
 * search params (`?tab=bugs`) switches in place, with no server round trip,
 * and is never prefetched, since nothing would be fetched for it.
 */
export function PageTabs({ label, tabs, current }: PageTabsProps) {
	const pathname = usePathname();

	return (
		<nav className="page-tabs" aria-label={label}>
			{tabs.map(({ id, label: name, href, count, tone }) => {
				const inPlace = pathOf(href) === pathname;

				function switchInPlace(event: MouseEvent<HTMLAnchorElement>): void {
					if (opensElsewhere(event)) return;

					event.preventDefault();
					replaceSearch(href);
				}

				return (
					<Link
						key={id}
						href={href}
						replace
						scroll={false}
						prefetch={inPlace ? false : undefined}
						onClick={inPlace ? switchInPlace : undefined}
						className="page-tab"
						aria-current={id === current ? 'page' : undefined}
					>
						{id === current ? <NavPill /> : null}
						{name}
						{count ? (
							<span className="page-tab-count" data-tone={tone}>
								{count}
							</span>
						) : null}
					</Link>
				);
			})}
		</nav>
	);
}
