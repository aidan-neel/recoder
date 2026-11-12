'use client';

import { Button, NavPill, NavPillGroup } from '@recoder/ui';
import { usePathname } from 'next/navigation';

import { activeTab, onSettings, QUEUE_TAB, queueHref, reviewHref } from '@/lib/shell/routes';
import type { ReviewTab } from '@/lib/shell/shell-store';

import { Grow } from './grow';
import { SearchButton } from './search-button';
import { QueueTabLabel, ReviewTabLabel } from './tab-label';
import { MoreFace } from './tab-overflow';
import { TabNav } from './tab-strip';
import { BarLayout } from './top-bar';
import { TopTab } from './top-tab';

/**
 * The ⌘K keycap before React knows the platform. It holds both labels, and
 * common.css shows the one for the `data-platform` the head script set, so a
 * keycap that reads Ctrl K never paints ⌘K first. It wears the kit keycap's
 * hooks, so it looks the same.
 */
function PlatformKeycap() {
	return (
		<kbd data-ui="keycap" data-key="mod+k" aria-hidden>
			<span data-platform-only="mac">⌘K</span>
			<span data-platform-only="other">Ctrl K</span>
		</kbd>
	);
}

/**
 * The search field at each size the bar's fit can give it. The server can't
 * know which, so all three are in its HTML and only one shows: the full one,
 * unless the boot script set `data-boot-search` on `<html>` to the size the
 * bar settled on last time for this window width and these tabs
 * (`BOOT_SEARCH_SCRIPT`). The sizes then match when the bar takes over.
 */
const BOOT_SEARCHES = [
	{ size: 'wide', className: 'contents [html[data-boot-search]_&]:hidden' },
	{ size: 'narrow', className: 'hidden [html[data-boot-search=narrow]_&]:contents' },
	{ size: 'icon', className: 'hidden [html[data-boot-search=icon]_&]:contents' }
] as const;

/** A review tab for the boot script to copy: every part a tab can show, which it fills in or drops. */
const PROTO_TAB: ReviewTab = { id: '', repo: '', pr: 0, title: '-', open: 1, high: false, seenAt: 0 };

/** The prototype's close button does nothing: only its copies show, and they leave as the app mounts. */
function noClose(): void {}

/**
 * One of each piece of the tab strip, hidden, made by the strip's own
 * components exactly as the strip lays them out: the separator, a finished
 * and a running review's tab, the room a review page keeps for its tab
 * before it opens, the pill and the More menu's trigger. The boot
 * script copies them to draw the saved tabs before first paint
 * (`BOOT_SEARCH_SCRIPT` names each `data-boot-proto`). They sit after the
 * strip, so the first tab or pill in the document is always a shown one.
 */
function BootPieces() {
	return (
		<div hidden aria-hidden inert data-boot-protos>
			<span data-boot-proto="separator">
				<Grow still>
					<span data-ui="top-tab-separator" />
				</Grow>
			</span>
			{[false, true].map((running) => (
				<span key={String(running)} data-boot-proto={running ? 'running' : 'done'}>
					<Grow still>
						<TopTab id="" href={reviewHref('')} active={false} onClose={noClose}>
							<ReviewTabLabel tab={{ ...PROTO_TAB, open: running ? null : 1 }} still />
						</TopTab>
					</Grow>
				</span>
			))}
			<span data-boot-proto="room">
				<Grow still>
					<span data-ui="tab-room" />
				</Grow>
			</span>
			<NavPillGroup>
				<span data-boot-proto="pill">
					<NavPill value="" className="bg-menu" />
				</span>
			</NavPillGroup>
			<span data-boot-proto="more">
				<Grow still>
					<Button variant="quiet" data-slot="tab-more">
						<MoreFace count={0} still />
					</Button>
				</Grow>
			</span>
		</div>
	);
}

/** Where the boot script draws the saved tabs. React renders it empty and never looks inside. */
const NO_HTML = { __html: '' };

/**
 * The top bar in the server's HTML and while the page hydrates, in the bar's
 * own layout and pieces, so the interactive bar replaces it on the same
 * pixels. The open review tabs and the Queue count live in local storage, so
 * the boot script lays them out before first paint: it draws the tabs and
 * the More menu the bar settled on last time for this window width and these
 * tabs, gives the search the size they leave it (`BOOT_SEARCH_SCRIPT`), and
 * keeps the Queue tab's room for the count it will show
 * (`BOOT_QUEUE_SCRIPT`), so nothing moves when the app takes over.
 */
export function BootBar() {
	const pathname = usePathname();
	const onQueue = activeTab(pathname) === QUEUE_TAB;

	return (
		<BarLayout
			settings={onSettings(pathname)}
			strip={
				<TabNav>
					<div data-ui="top-tabs">
						<NavPillGroup>
							<TopTab id={QUEUE_TAB} href={queueHref(pathname)} active={onQueue} current={onQueue}>
								<QueueTabLabel waiting={null} reserve still />
							</TopTab>
							<span data-boot-tabs className="contents" suppressHydrationWarning dangerouslySetInnerHTML={NO_HTML} />
						</NavPillGroup>
					</div>
					<BootPieces />
				</TabNav>
			}
			search={BOOT_SEARCHES.map(({ size, className }) => (
				<span key={size} className={className}>
					<SearchButton size={size} keycap={<PlatformKeycap />} />
				</span>
			))}
		/>
	);
}
