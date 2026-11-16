'use client';

import { NavPill } from '@recoder/ui';

import { useIntent } from '@/lib/shell/intent';

import { TabLink } from './tab-link';

/** One tab of a page: a link with its own address. */
export interface PageTab {
	id: string;
	label: string;
	href: string;
	/** A number after the label (files, open bugs). Null or zero shows none. */
	count?: number | null;
	/** `bugs` colors the count as a warning. */
	tone?: 'bugs';
	/** Starts reading what the tab shows, once the pointer or focus rests on it. */
	warm?: () => void;
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
			{tabs.map((tab) => (
				<PageTabLink key={tab.id} tab={tab} current={tab.id === current} />
			))}
		</nav>
	);
}

/** One tab: its link, its count, and the fill when it is open. */
function PageTabLink({ tab, current }: { tab: PageTab; current: boolean }) {
	const intent = useIntent(tab.warm);

	return (
		<TabLink href={tab.href} className="page-tab" aria-current={current ? 'page' : undefined} {...intent}>
			{current ? <NavPill /> : null}
			{tab.label}
			{tab.count ? (
				<span className="page-tab-count" data-tone={tab.tone}>
					{tab.count}
				</span>
			) : null}
		</TabLink>
	);
}
