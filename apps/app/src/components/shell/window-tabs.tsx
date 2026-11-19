'use client';

import {
	Button,
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
	StatusGlyph,
	Tooltip,
	type GlyphKind
} from '@recoder/ui';
import {
	BookOpenIcon,
	ChatCircleIcon,
	ClockIcon,
	FolderSimpleIcon,
	GearIcon,
	GitPullRequestIcon,
	ListBulletsIcon,
	PlusIcon,
	QuestionIcon,
	XIcon,
	type Icon
} from '@phosphor-icons/react';
import { Reorder } from 'motion/react';
import { useEffect, useRef, useState, type KeyboardEvent as KeyEvent, type MouseEvent, type WheelEvent } from 'react';

import { useApi } from '@/lib/api/client';
import { copyLink } from '@/lib/shell/copy-link';
import { closeTabs, duplicateTab, openTab, reopenTab, reorderTabs, switchTab } from '@/lib/shell/navigation';
import { newReviewHref, pullsHref, routeOf, titleOf, type Route } from '@/lib/shell/routes';
import { useTabNames, type TabName } from '@/lib/shell/tab-names';
import { currentHref, pathOf, useTabs, type WindowTab } from '@/lib/shell/tabs';

/** The mark each screen's tab carries before its name. */
const ICONS: Record<Route['screen'], Icon> = {
	pulls: ListBulletsIcon,
	pull: GitPullRequestIcon,
	review: GitPullRequestIcon,
	new: PlusIcon,
	repos: FolderSimpleIcon,
	repo: FolderSimpleIcon,
	chat: ChatCircleIcon,
	automations: ClockIcon,
	guidelines: BookOpenIcon,
	settings: GearIcon,
	missing: QuestionIcon
};

/** The review states a tab marks at its end: work under way or something to look at. A clean review needs no mark. */
const GLYPHS: Partial<Record<NonNullable<TabName['review']>, GlyphKind>> = {
	queued: 'idle',
	running: 'spinner',
	bugs: 'high',
	failed: 'failed'
};

/**
 * Scrolls the strip just far enough to show the tab on screen. It moves `scrollLeft` itself because
 * `scrollIntoView` also moves Chromium's starting point for Tab, so the first Tab after a load skipped the skip link,
 * the account and the sidebar's toggle.
 */
function keepActiveInView(strip: HTMLElement): void {
	const tab = strip.querySelector('[data-active]');

	if (!tab) return;

	const box = tab.getBoundingClientRect();
	const view = strip.getBoundingClientRect();

	if (box.left < view.left) strip.scrollLeft -= view.left - box.left;
	else if (box.right > view.right) strip.scrollLeft += box.right - view.right;
}

/**
 * Shift+F10 opens a tab's menu under it, as the Menu key does. Chromium on a Mac sends no `contextmenu` for either, so
 * without this a keyboard could not reach Duplicate tab or Close other tabs there.
 */
function openMenuFromKeys(event: KeyEvent<HTMLButtonElement>): void {
	if (event.key !== 'F10' || !event.shiftKey) return;

	event.preventDefault();

	const box = event.currentTarget.getBoundingClientRect();

	event.currentTarget.dispatchEvent(
		new globalThis.MouseEvent('contextmenu', {
			bubbles: true,
			cancelable: true,
			clientX: box.left + 8,
			clientY: box.bottom
		})
	);
}

/** Tabs that `alt+1`…`alt+8` reach by place; `alt+9` is always the last. */
const ORDINALS = 9;

/**
 * True while Alt (Option) is held on its own, when the first nine tabs show the number that reaches them. Any other
 * key, a click or leaving the window hides them again.
 */
function useAltHeld(): boolean {
	const [held, setHeld] = useState(false);

	useEffect(() => {
		function onKey(event: KeyboardEvent): void {
			setHeld(event.key === 'Alt' && event.type === 'keydown' && !event.ctrlKey && !event.metaKey);
		}

		const release = () => setHeld(false);

		window.addEventListener('keydown', onKey);
		window.addEventListener('keyup', onKey);
		window.addEventListener('pointerdown', release);
		window.addEventListener('blur', release);

		return () => {
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('keyup', onKey);
			window.removeEventListener('pointerdown', release);
			window.removeEventListener('blur', release);
		};
	}, []);

	return held;
}

/** The ordinal a tab shows while Alt is held, or null past the ninth. The last tab answers to 9 too. */
function ordinalOf(index: number, count: number): number | null {
	if (index === count - 1 && count > ORDINALS) return ORDINALS;

	return index < ORDINALS - 1 || count <= ORDINALS ? index + 1 : null;
}

/**
 * The window's tabs, each holding a page and its own history, in a row the person orders by dragging; then the +
 * that opens New review in a tab of its own. A click brings a tab to the screen, a middle click or its X closes it, and a right click offers the
 * rest. Too many to fit, they narrow and then scroll, the one on screen kept in view.
 */
export function WindowTabs() {
	const { base } = useApi();
	const tabs = useTabs((state) => state.tabs);
	const activeId = useTabs((state) => state.activeId);
	const reopenable = useTabs((state) => state.closed.length > 0);
	const names = useTabNames();
	const ordinals = useAltHeld();
	const strip = useRef<HTMLElement>(null);

	useEffect(() => {
		if (strip.current) keepActiveInView(strip.current);
	}, [activeId, tabs.length]);

	/** A wheel's vertical turn scrolls the row sideways, as the row has no other way to scroll with a mouse. */
	function scrollSideways(event: WheelEvent<HTMLElement>): void {
		if (strip.current && Math.abs(event.deltaY) > Math.abs(event.deltaX)) strip.current.scrollLeft += event.deltaY;
	}

	return (
		<div className="window-tabs">
			<Reorder.Group
				as="nav"
				ref={strip}
				axis="x"
				layoutScroll
				values={tabs.map((tab) => tab.id)}
				onReorder={reorderTabs}
				aria-label="Open tabs"
				className="window-tab-strip"
				data-ordinals={ordinals || undefined}
				onWheel={scrollSideways}
			>
				{tabs.map((tab, index) => (
					<WindowTabItem
						key={tab.id}
						tab={tab}
						tabs={tabs}
						ordinal={ordinalOf(index, tabs.length)}
						active={tab.id === activeId}
						name={names.get(pathOf(currentHref(tab))) ?? null}
						route={routeOf(pathOf(currentHref(tab)), base)}
						home={pullsHref(base)}
						fresh={newReviewHref(base)}
						reopenable={reopenable}
					/>
				))}
			</Reorder.Group>
			<Tooltip content="New review" shortcut="alt+t">
				<Button
					variant="ghost"
					size="icon"
					aria-label="New review"
					className="window-tab-new"
					onClick={() => openTab(newReviewHref(base))}
				>
					<PlusIcon />
				</Button>
			</Tooltip>
		</div>
	);
}

interface WindowTabItemProps {
	tab: WindowTab;
	tabs: WindowTab[];
	ordinal: number | null;
	active: boolean;
	name: TabName | null;
	route: Route;
	/** Where a window goes when its last tab closes. */
	home: string;
	/** Where a new tab opens. */
	fresh: string;
	/** Whether a closed tab can come back. */
	reopenable: boolean;
}

/** One tab: its mark, its page's name, a review's state at the end, and the X that closes it in that place on hover. */
function WindowTabItem({ tab, tabs, ordinal, active, name, route, home, fresh, reopenable }: WindowTabItemProps) {
	const Icon = ICONS[route.screen];
	const label = name?.label ?? titleOf(route);
	const glyph = name?.review ? GLYPHS[name.review] : undefined;
	const index = tabs.indexOf(tab);
	const others = tabs.filter((other) => other.id !== tab.id).map((other) => other.id);
	const after = tabs.slice(index + 1).map((other) => other.id);

	/** The middle button closes the tab, as in a browser; its press would otherwise start the page's autoscroll. */
	function middle(event: MouseEvent): void {
		if (event.button !== 1) return;

		event.preventDefault();

		if (event.type === 'auxclick') closeTabs([tab.id], home);
	}

	return (
		<Reorder.Item
			as="div"
			value={tab.id}
			className="window-tab"
			data-active={active || undefined}
			onMouseDown={middle}
			onAuxClick={middle}
		>
			<ContextMenu>
				<ContextMenuTrigger>
					<button
						type="button"
						className="window-tab-main"
						aria-current={active ? 'page' : undefined}
						onClick={() => switchTab(tab.id)}
						onKeyDown={openMenuFromKeys}
					>
						<span className="window-tab-mark">
							<Icon aria-hidden />
							{ordinal === null ? null : (
								<span className="window-tab-ordinal" aria-hidden>
									{ordinal}
								</span>
							)}
						</span>
						<span className="window-tab-label">{label}</span>
					</button>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-[220px]">
					<ContextMenuItem shortcut="alt+t" onSelect={() => openTab(fresh)}>
						New tab
					</ContextMenuItem>
					<ContextMenuItem onSelect={() => duplicateTab(tab.id)}>Duplicate tab</ContextMenuItem>
					<ContextMenuItem onSelect={() => copyLink(new URL(currentHref(tab), location.origin).href)}>
						Copy link
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem shortcut={active ? 'alt+w' : undefined} onSelect={() => closeTabs([tab.id], home)}>
						Close tab
					</ContextMenuItem>
					<ContextMenuItem disabled={others.length === 0} onSelect={() => closeTabs(others, home)}>
						Close other tabs
					</ContextMenuItem>
					<ContextMenuItem disabled={after.length === 0} onSelect={() => closeTabs(after, home)}>
						Close tabs to the right
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem shortcut="alt+shift+t" disabled={!reopenable} onSelect={reopenTab}>
						Reopen closed tab
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			{glyph ? (
				<span className="window-tab-status">
					<StatusGlyph kind={glyph} />
				</span>
			) : null}
			<Button
				variant="ghost"
				size="icon"
				tabIndex={-1}
				className="window-tab-close"
				aria-label={`Close ${label}`}
				onClick={() => closeTabs([tab.id], home)}
			>
				<XIcon />
			</Button>
		</Reorder.Item>
	);
}
