'use client';

import { NavPill } from '@recoder/ui';
import Link from 'next/link';

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

/**
 * A page's tabs as links, so each has an address and opens in a new browser
 * tab like any link. The open one sits on a fill.
 */
export function PageTabs({ label, tabs, current }: PageTabsProps) {
	return (
		<nav className="page-tabs" aria-label={label}>
			{tabs.map(({ id, label: name, href, count, tone }) => (
				<Link
					key={id}
					href={href}
					replace
					scroll={false}
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
			))}
		</nav>
	);
}
