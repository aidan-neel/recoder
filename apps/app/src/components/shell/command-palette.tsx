'use client';

import {
	CommandDialog,
	CommandEmpty,
	CommandFooter,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	type CommandHint
} from '@recoder/ui';
import { GitPullRequestArrow } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState, type KeyboardEvent } from 'react';

import type { QueueEntry } from '@/lib/queue/queue';
import { useQueue } from '@/lib/queue/queue-store';
import { useReview } from '@/lib/review/review-store';
import { pullRef } from '@/lib/shell/format';
import { paletteScore } from '@/lib/shell/palette-filter';
import { activeTab, paletteScope } from '@/lib/shell/routes';
import { useShell, type PaletteItem, type ReviewTab } from '@/lib/shell/shell-store';

import { actionItems, tabItems } from './palette-items';
import { usePullReview } from './use-pull-review';
import { useRecentReviews } from './use-recent-reviews';
import { useTabActions } from './use-tab-actions';

const HINTS: CommandHint[] = [
	{ keys: ['ArrowUp', 'ArrowDown'], label: 'navigate' },
	{ keys: ['Enter'], label: 'open' },
	{ keys: ['Escape'], label: 'close' }
];

/** Pull request mode adds the way back to the main list. */
const PULL_HINTS: CommandHint[] = [...HINTS.slice(0, 2), { keys: ['Backspace'], label: 'back' }, HINTS[2]];

const PLACEHOLDER = {
	review: 'Search this review and actions',
	queue: 'Search pull requests and actions',
	settings: 'Search settings and actions',
	pull: 'Paste a pull request link, or type its number'
} as const;

interface Row {
	item: PaletteItem;
	/** What cmdk searches and keys the row by. */
	value: string;
}

/**
 * Pairs each item with its search text. cmdk keys rows by that text, so a
 * repeat (two findings with one title and place) gets invisible padding.
 */
function rows(items: PaletteItem[]): Row[] {
	const seen = new Set<string>();

	return items.map((item) => {
		let value = `${item.label} ${item.detail ?? ''}`.trim();

		while (seen.has(value)) value += '​';

		seen.add(value);

		return { item, value };
	});
}

/** Rows grouped under their headings, in the order each heading first appears. */
function grouped(list: Row[]): [string, Row[]][] {
	const groups = new Map<string, Row[]>();

	for (const row of list) groups.set(row.item.group, [...(groups.get(row.item.group) ?? []), row]);

	return [...groups];
}

/** The open tabs the page does not already list: on the queue, a tab's pull request is a row of its own. */
function unlisted(tabRows: PaletteItem[], pageItems: PaletteItem[]): PaletteItem[] {
	const listed = new Set(pageItems.map((item) => item.detail));

	return tabRows.filter((item) => !listed.has(item.detail));
}

/** Reviews the palette already reaches without the Reviews group: open tabs, the one on screen, and the queue's rows. */
function shownReviews(tabs: ReviewTab[], active: string | null, listed: QueueEntry[] | null): Set<string> {
	const rows = (listed ?? []).flatMap((entry) => (entry.review ? [entry.review.id] : []));

	return new Set([...tabs.map((tab) => tab.id), ...(active ? [active] : []), ...rows]);
}

/**
 * The ⌘K palette: what the page publishes first (pull requests, decisions,
 * files), then the open review tabs, then app-wide actions, then the
 * reviews the server keeps that no row above reaches. A pasted pull request link offers to review it;
 * "Review a pull request…" switches the palette to take a link or a number.
 * Choosing a row closes the palette, then runs it, unless the row keeps it
 * open to show its progress. Switching mode clears the search.
 */
export function CommandPalette() {
	const open = useShell((state) => state.paletteOpen);
	const pageItems = useShell((state) => state.pageItems);
	const tabs = useShell((state) => state.tabs);
	const setOpen = useShell((state) => state.setPaletteOpen);
	const pathname = usePathname();
	const active = activeTab(pathname);
	const review = tabs.find((tab) => tab.id === active);
	const { open: openTab, close } = useTabActions();
	const [search, setSearch] = useState('');
	const [wasOpen, setWasOpen] = useState(open);

	const go = (id: string) => {
		setOpen(false);
		openTab(id);
	};

	const pageScope = paletteScope(pathname);
	const sample = useReview((state) => state.sample);
	const listed = useQueue((state) => (pageScope === 'queue' ? state.entries : null));
	const pull = usePullReview(open, go);
	const recent = useRecentReviews(open, shownReviews(tabs, active, listed), openTab);
	const scope = pull.active ? 'pull' : pageScope;

	const [wasPull, setWasPull] = useState(pull.active);

	if (wasOpen !== open || wasPull !== pull.active) {
		setWasOpen(open);
		setWasPull(pull.active);
		setSearch('');
	}

	const items = pull.active
		? pull.items(search)
		: [
				...pull.items(search),
				...pageItems,
				...unlisted(tabItems(tabs, active, openTab), pageItems),
				...actionItems(openTab, review ? () => close([review.id]) : null, pageScope === 'review' && !sample),
				pull.action,
				...recent
			];

	const where = {
		review: review ? `in ${pullRef(review.repo, review.pr)}` : 'this review',
		queue: 'the queue',
		settings: 'settings',
		pull: null
	}[scope];

	function choose(item: PaletteItem): void {
		if (!item.keepOpen) setOpen(false);

		item.run();
	}

	/** Backspace in an empty field leaves pull request mode for the main list. */
	function onKeyDown(event: KeyboardEvent): void {
		if (pull.active && event.key === 'Backspace' && search === '') pull.leave();
	}

	return (
		<CommandDialog
			open={open}
			onOpenChange={setOpen}
			label="Search Recoder"
			shouldFilter={!pull.active}
			filter={paletteScore}
		>
			<CommandInput
				placeholder={PLACEHOLDER[scope]}
				value={search}
				onValueChange={setSearch}
				leading={
					pull.active ? <GitPullRequestArrow aria-hidden className="size-4 shrink-0 text-fg-muted" /> : undefined
				}
				trailing={where ? <span aria-live="polite">{where}</span> : undefined}
				onKeyDown={onKeyDown}
			/>
			<CommandList>
				{grouped(rows(items)).map(([heading, list]) => (
					<CommandGroup key={heading} heading={heading}>
						{list.map(({ item, value }) => (
							<CommandItem
								key={item.id}
								value={value}
								keywords={item.keywords?.split(/\s+/)}
								icon={item.icon}
								iconTone={item.tone}
								detail={item.detail}
								shortcut={item.shortcut}
								onSelect={() => choose(item)}
							>
								{item.label}
							</CommandItem>
						))}
					</CommandGroup>
				))}
				<CommandEmpty>{pull.active ? pull.empty(search) : undefined}</CommandEmpty>
			</CommandList>
			<CommandFooter hints={pull.active ? PULL_HINTS : HINTS} />
		</CommandDialog>
	);
}
