'use client';

import {
	Button,
	CommandDialog,
	CommandEmpty,
	CommandFooter,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	SkeletonRows,
	StatusNotice,
	type CommandHint
} from '@recoder/ui';
import { GitPullRequestArrow } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import type { QueueEntry } from '@/lib/queue/queue';
import { useQueue } from '@/lib/queue/queue-store';
import { useReview } from '@/lib/review/review-store';
import { pullRef } from '@/lib/shell/format';
import { itemText, paletteScore } from '@/lib/shell/palette-filter';
import { activeTab, paletteScope } from '@/lib/shell/routes';
import { useSelectedFocusOnClose } from '@/lib/shell/selected-focus';
import { INTENT_MS } from '@/lib/shell/settings-warm';
import { useShell, type PaletteItem, type ReviewTab } from '@/lib/shell/shell-store';
import { closeReviewTabs, goToTab } from '@/lib/shell/tab-actions';
import { useAction } from '@/lib/shell/use-action';

import { actionItems, tabItems } from './palette-items';
import { usePullReview } from './use-pull-review';
import { useRecentReviews, type RecentReviews } from './use-recent-reviews';

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
		let value = itemText(item);

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

/**
 * The rows the frame that opens the palette draws. Twelve 36px rows stand
 * 432px, past the list's 420px cap even with no heading, so the list opens
 * at its full height and every row after them lands below the fold a frame
 * later. The list's box never changes size; only the dialog's 0.95 entrance
 * scale makes it measure smaller on screen for the first frames.
 */
const OPENING_ROWS = 12;

/** The first `count` rows in the order the list shows them, under the same headings. */
function leading(groups: [string, Row[]][], count: number): [string, Row[]][] {
	let left = count;

	return groups.flatMap(([heading, list]): [string, Row[]][] => {
		if (left <= 0) return [];

		const kept = list.slice(0, left);

		left -= kept.length;

		return [[heading, kept]];
	});
}

/**
 * True from the render that opens the palette until a frame has painted it.
 * The opening frame then builds only the rows it shows, and the commit that
 * draws the palette stays light.
 */
function useOpeningFrame(open: boolean): boolean {
	const [painted, setPainted] = useState(false);
	const [wasOpen, setWasOpen] = useState(open);

	if (open !== wasOpen) {
		setWasOpen(open);
		setPainted(false);
	}

	useEffect(() => {
		if (!open || painted) return;

		const frame = requestAnimationFrame(() => setPainted(true));

		return () => cancelAnimationFrame(frame);
	}, [open, painted]);

	return open && !painted;
}

/** The row the palette's list has selected; the list marks it and keeps its search text, trimmed, in `data-value`. */
const SELECTED_ROW = '[data-ui="command-item"][aria-selected="true"]';

/** The panel of a palette that just opened is in the page within a few frames; past this many the read-ahead gives up. */
const PANEL_FRAMES = 10;

/**
 * Reads ahead what the selected row opens once the selection, moved by the
 * arrows, the pointer or the search, has rested on it for {@link INTENT_MS}
 * (`PaletteItem.prepare`), so choosing it paints whole in one swap. It
 * reads the latest rows when the selection moves.
 */
function usePrepareOnRest(open: boolean, list: Row[]): void {
	const latest = useRef(list);

	useEffect(() => {
		latest.current = list;
	});

	useEffect(() => {
		if (!open) return;

		let frames = 0;
		let frame = requestAnimationFrame(find);
		let observer: MutationObserver | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let selected: string | null = null;

		function check(panel: Element): void {
			const value = panel.querySelector(SELECTED_ROW)?.getAttribute('data-value') ?? null;

			if (value === selected) return;

			selected = value;
			clearTimeout(timer);

			const prepare = latest.current.find((row) => row.value.trim() === value)?.item.prepare;

			if (prepare) timer = setTimeout(prepare, INTENT_MS);
		}

		function find(): void {
			const panel = document.querySelector('[data-ui="command-dialog"]');

			if (!panel) {
				if (frames++ < PANEL_FRAMES) frame = requestAnimationFrame(find);

				return;
			}

			observer = new MutationObserver(() => check(panel));
			observer.observe(panel, { subtree: true, childList: true, attributeFilter: ['aria-selected'] });
			check(panel);
		}

		return () => {
			cancelAnimationFrame(frame);
			observer?.disconnect();
			clearTimeout(timer);
		};
	}, [open]);
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

/** The two placeholder rows' title widths: a palette row is one line. */
const LOADING_WIDTHS = [
	['46%', '0'],
	['34%', '0']
] as const;

/**
 * Where the Reviews group stands before its first list lands: two placeholder
 * rows as tall as palette rows while the first read is out, or a line saying
 * it failed, with Try again. Later opens paint the kept list at once.
 */
function RecentStatus({ recent }: { recent: RecentReviews }) {
	const retry = useAction();

	if (recent.loading) {
		return <SkeletonRows count={2} height={36} glyph lines={1} widths={LOADING_WIDTHS} rowClassName="px-2.5" />;
	}

	if (!recent.failed) return null;

	return (
		<StatusNotice
			variant="inline"
			tone="danger"
			title="Couldn’t load past reviews."
			actions={
				<Button variant="ghost" status={retry.status} onClick={() => retry.run(recent.retry)}>
					Try again
				</Button>
			}
			className="px-2.5"
		/>
	);
}

/**
 * The ⌘K palette: what the page publishes first (pull requests, decisions,
 * files), then the open review tabs, then app-wide actions, then the
 * reviews the server keeps that no row above reaches. A pasted pull request link offers to review it;
 * "Review a pull request…" switches the palette to take a link or a number.
 * Choosing a row closes the palette, then runs it, unless the row keeps it
 * open to show its progress. Switching mode clears the search. The shell
 * loads it on the first ⌘K, so no page pays for it before. The frame that
 * opens it draws the first screen of rows; the rest follow a frame later,
 * below the fold.
 */
export function CommandPalette() {
	const open = useShell((state) => state.paletteOpen);
	const pageItems = useShell((state) => state.pageItems);
	const tabs = useShell((state) => state.tabs);
	const setOpen = useShell((state) => state.setPaletteOpen);
	const pathname = useShell((state) => state.pathname);
	const active = activeTab(pathname);
	const review = tabs.find((tab) => tab.id === active);
	const [search, setSearch] = useState('');
	const [wasOpen, setWasOpen] = useState(open);
	const chosenRef = useRef(false);

	const go = (id: string) => {
		chosenRef.current = true;
		setOpen(false);
		goToTab(id);
	};

	useSelectedFocusOnClose(open, '[data-ui="command-dialog"]', chosenRef);

	const pageScope = paletteScope(pathname);
	const sample = useReview((state) => state.sample);
	const listed = useQueue((state) => (pageScope === 'queue' ? state.entries : null));
	const pull = usePullReview(open, go);
	const recent = useRecentReviews(open, pull.active ? '' : search, shownReviews(tabs, active, listed), goToTab);
	const scope = pull.active ? 'pull' : pageScope;
	const opening = useOpeningFrame(open);

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
				...unlisted(tabItems(tabs, active, goToTab), pageItems),
				...actionItems(goToTab, review ? () => closeReviewTabs([review.id]) : null, pageScope === 'review' && !sample),
				pull.action,
				...recent.items
			];

	const listRows = rows(items);
	const groups = grouped(listRows);
	const capped = opening && items.length > OPENING_ROWS;
	const shown = capped ? leading(groups, OPENING_ROWS) : groups;

	usePrepareOnRest(open, listRows);

	const where = {
		review: review ? `in ${pullRef(review.repo, review.pr)}` : 'this review',
		queue: 'the queue',
		settings: 'settings',
		pull: null
	}[scope];

	function choose(item: PaletteItem): void {
		if (!item.keepOpen) {
			chosenRef.current = true;
			setOpen(false);
		}

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
				{shown.map(([heading, list]) => (
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
				{pull.active || capped ? null : <RecentStatus recent={recent} />}
				<CommandEmpty>{pull.active ? pull.empty(search) : undefined}</CommandEmpty>
			</CommandList>
			<CommandFooter hints={pull.active ? PULL_HINTS : HINTS} />
		</CommandDialog>
	);
}
