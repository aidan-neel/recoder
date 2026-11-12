'use client';

import { ContextMenu, ContextMenuTrigger, NavPillGroup } from '@recoder/ui';
import { AnimatePresence } from 'motion/react';
import { memo, useEffect, useState, type MouseEvent, type ReactNode, type Ref } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { DeleteReviewDialog, type DeleteTarget } from '@/components/queue/delete-review-dialog';
import { useQueue, useQueueWaiting } from '@/lib/queue/queue-store';
import { pullRef } from '@/lib/shell/format';
import { activeTab, inSample, QUEUE_TAB, queueHref, reviewHref } from '@/lib/shell/routes';
import { bootKeptQueueRoom, saveQueueCount } from '@/lib/shell/saved-bar';
import { useShell, type ReviewTab } from '@/lib/shell/shell-store';
import { closeReviewTabs } from '@/lib/shell/tab-actions';
import { neighborAfterClose, type TabFit } from '@/lib/shell/tab-fit';
import { useLastShown } from '@/lib/shell/use-last-shown';

import { Grow } from './grow';
import { QueueTabLabel, ReviewTabLabel, tabTitle } from './tab-label';
import { TabMenu } from './tab-menu';
import { TabOverflow } from './tab-overflow';
import { TabRuler } from './tab-ruler';
import { TopTab } from './top-tab';
import { usePillTab } from './use-pill-tab';

interface TabStripProps {
	/** The tab the page shows: the queue, a review id, or null on settings. */
	active: string | null;
	/** What fits; null until the first measure, when only the Queue tab shows. */
	fit: TabFit | null;
	/** The review page's tab while the fit keeps room for it before it opens (`useTabFit`). */
	opening: string | null;
	rulerRef: Ref<HTMLDivElement>;
}

type ShellState = ReturnType<typeof useShell.getState>;

/**
 * The open tabs' ids in order. The list keeps its identity while the same
 * tabs stay open in the same order, so a decision that changes a tab's count
 * does not render the strip; each tab, the ruler and the More menu read what
 * their tabs show.
 */
function useTabIds(): string[] {
	return useShell(useShallow(({ tabs }: ShellState) => tabs.map((tab) => tab.id)));
}

/**
 * What tab `id` shows, through `pick`, compared field by field. A tab that
 * has closed keeps the last answer, so it keeps its face while it collapses.
 */
function useKeptTab<T>(id: string, pick: (tab: ReviewTab) => T): T | null {
	const shown = useShell(
		useShallow(({ tabs }: ShellState) => {
			const tab = tabs.find((item) => item.id === id);

			return tab ? pick(tab) : null;
		})
	);

	return useLastShown(shown);
}

/**
 * True while `tab` has a place it did not have a moment ago: the pill's tab
 * came out of the More menu because it opened, or the page's tab (or its
 * room, before it opens) just joined the bar or the menu. The tabs it
 * displaces leave at once, and a More menu it brings lands at once, so the
 * pill slides to where the tab stays instead of chasing it while the bar
 * reflows. Any other change to the tabs or the menu turns it off again.
 */
function useSwap(tab: string | null, shown: string[], hidden: string[]): boolean {
	const key = `${shown.join(' ')}|${hidden.join(' ')}`;
	const [last, setLast] = useState({ key, shown, hidden, swap: false });

	if (last.key === key) return last.swap;

	const holds = (list: string[]) => tab !== null && list.includes(tab);
	const swap = !holds(last.shown) && (holds(shown) || (holds(hidden) && !holds(last.hidden)));

	setLast({ key, shown, hidden, swap });

	return swap;
}

/**
 * True while the Queue tab keeps the room the boot bar kept for its count
 * (`BOOT_QUEUE_SCRIPT`): on a queue page, from the app's mount until its
 * list first settles, with its count or without one. The count then shows in
 * that room; a queue that settles with none gives the room back. Another
 * page loads no list: its count comes back with the saved one as the app
 * mounts, before the first paint, or not at all, so it keeps no room. Once
 * settled it never holds room again, so a queue reset as its page closes
 * leaves no gap.
 */
function useCountRoom(sample: boolean, queuePage: boolean): boolean {
	const [kept] = useState(bootKeptQueueRoom);
	const settled = useQueue((state) => !queuePage || (state.sample === sample && state.status !== 'loading'));
	const [done, setDone] = useState(false);

	if (settled && !done) setDone(true);

	return kept && !done && !settled;
}

/** Saves the count the shell shows for the queue in the store, once its list is known (`saveQueueCount`). */
function saveCount({ status, sample, loadedAt }: ReturnType<typeof useQueue.getState>): void {
	if (status !== 'ready' && status !== 'empty') return;

	const scope = sample ? 'sample' : 'live';

	saveQueueCount(scope, useShell.getState().waiting[scope] ?? 0, sample ? null : loadedAt);
}

/**
 * Keeps the count each queue shows on the Queue tab, with when its list
 * loaded, for the next load's boot bar. It saves the list the app mounted
 * with, then each new one; the store's own subscription, which gives the
 * shell the count, runs first.
 */
function useSaveQueueCount(): void {
	useEffect(() => {
		saveCount(useQueue.getState());

		return useQueue.subscribe((state, previous) => {
			const changed = (['status', 'sample', 'entries', 'loadedAt'] as const).some(
				(key) => state[key] !== previous[key]
			);

			if (changed) saveCount(state);
		});
	}, []);
}

/** Puts focus on a tab's link once the bar has re-rendered; the Queue tab when that tab went into the More menu. */
function focusTab(id: string): void {
	requestAnimationFrame(() => {
		const link = (tab: string) =>
			document.querySelector<HTMLElement>(`[data-ui="top-tab-link"][data-tab-id="${CSS.escape(tab)}"]`);

		(link(id) ?? link(QUEUE_TAB))?.focus();
	});
}

/**
 * Closes a tab from its X. Pressed from the keyboard, focus moves to the tab
 * that takes its place, so the person keeps their spot in the bar.
 */
function closeTab(id: string, keyboard: boolean): void {
	const ids = useShell.getState().tabs.map((tab) => tab.id);

	closeReviewTabs([id]);

	if (keyboard) focusTab(neighborAfterClose(ids, [id], id) ?? QUEUE_TAB);
}

interface QueueTabProps {
	href: string;
	active: boolean;
	current: boolean;
	waiting: number | null;
	/** Keeps the boot bar's room for the count until it is known (`useCountRoom`). */
	reserve: boolean;
}

/** The Queue tab. Memoized, like each review tab, so the strip re-renders without touching tabs that did not change. */
const QueueTab = memo(function QueueTab({ href, active, current, waiting, reserve }: QueueTabProps) {
	return (
		<TopTab id={QUEUE_TAB} href={href} active={active} current={current}>
			<QueueTabLabel waiting={waiting} reserve={reserve} />
		</TopTab>
	);
});

/** A review tab's face: its state, name and count. It alone follows its tab, so a new count renders only this. */
function ReviewTabFace({ id }: { id: string }) {
	const tab = useKeptTab(id, (item) => item);

	return tab ? <ReviewTabLabel tab={tab} /> : null;
}

/** What a review tab's link and close button say: its full title and which pull request it closes. */
function tabNames(tab: ReviewTab): { title: string; close: string } {
	return { title: tabTitle(tab), close: `Close ${pullRef(tab.repo, tab.pr)}` };
}

interface ReviewTabItemProps {
	id: string;
	active: boolean;
	current: boolean;
}

/**
 * One review's tab, which renders again only when its pill, its page or its
 * names change; its face follows the rest of the tab on its own.
 */
const ReviewTabItem = memo(function ReviewTabItem({ id, active, current }: ReviewTabItemProps) {
	const names = useKeptTab(id, tabNames);

	return (
		<TopTab
			id={id}
			href={reviewHref(id)}
			active={active}
			current={current}
			title={names?.title}
			closeLabel={names?.close}
			onClose={(keyboard) => closeTab(id, keyboard)}
		>
			<ReviewTabFace id={id} />
		</TopTab>
	);
});

interface RulerProps {
	waiting: number | null;
	reserve: boolean;
	rulerRef: Ref<HTMLDivElement>;
}

/** The hidden ruler, fed every tab as it is now, so a new count re-measures the bar. */
function Ruler({ waiting, reserve, rulerRef }: RulerProps) {
	const tabs = useShell((state) => state.tabs);

	return <TabRuler ref={rulerRef} tabs={tabs} waiting={waiting} reserve={reserve} />;
}

/**
 * The More menu, fed the tabs in it as they are now; it renders again only
 * when one of those changes. Its count takes in the page's tab before it
 * opens, when the fit keeps that tab's room in the menu. Once it holds
 * nothing it keeps what it held, so it keeps its face while it collapses.
 */
function Overflow({ ids, holdsActive }: { ids: string[]; holdsActive: boolean }) {
	const tabs = useShell(useShallow((state) => state.tabs.filter((tab) => ids.includes(tab.id))));
	const kept = useLastShown(ids.length > 0 ? tabs : null);
	const count = useLastShown(ids.length > 0 ? ids.length : null);

	return <TabOverflow tabs={kept ?? tabs} count={count ?? 0} holdsActive={holdsActive} />;
}

/** The strip's landmark, which the boot frame draws too, so the strip lands in the same place. */
export function TabNav({ children }: { children: ReactNode }) {
	return (
		<nav aria-label="Queue and open reviews" className="relative flex h-full min-w-0 flex-1 items-center">
			{children}
		</nav>
	);
}

/**
 * The Queue tab, then one tab per open review, then a More menu for the ones
 * that do not fit. The active tab sits on a pill that slides between tabs; a
 * new tab grows in and a closed one collapses while the rest reflow. The
 * first tab, which opens with its page, lands with its separator at once, so
 * it does not slide over while the pill travels to it. A tab shows once the
 * fit has placed it, so a tab that just opened never paints at a size the
 * bar has not measured; a review page's tab has its place from the page's
 * first frame (`opening`): an empty room where it will land, or a place in
 * the More menu. That room, and the separator and More menu it brings, land
 * with the page.
 */
export function TabStrip({ active, fit, opening, rulerRef }: TabStripProps) {
	const pathname = useShell((state) => state.pathname);
	const ids = useTabIds();
	const sample = inSample(pathname);
	const current = activeTab(pathname);
	const waiting = useQueueWaiting(sample ? 'sample' : 'live');
	const reserve = useCountRoom(sample, current === QUEUE_TAB);
	const lit = usePillTab(active, ids);
	const [menuTab, setMenuTab] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
	const visible = new Set(fit?.visible);
	const room = opening !== null && visible.has(opening) && !ids.includes(opening) ? [opening] : [];
	const shown = [...ids.filter((id) => visible.has(id)), ...room];
	const overflow = (fit?.hidden ?? []).filter((id) => id === opening || ids.includes(id));
	const swap = useSwap(opening ?? lit, shown, overflow);

	useSaveQueueCount();

	/** The context menu acts on the tab under the pointer, or on the bar when there is none. */
	function track(event: MouseEvent): void {
		const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tab]') : null;

		setMenuTab(target?.dataset.tab ?? null);
	}

	return (
		<TabNav>
			<ContextMenu>
				<ContextMenuTrigger>
					<div data-ui="top-tabs" onContextMenuCapture={track}>
						<NavPillGroup>
							<QueueTab
								href={queueHref(pathname)}
								active={lit === QUEUE_TAB}
								current={current === QUEUE_TAB}
								waiting={waiting}
								reserve={reserve}
							/>
							{fit ? (
								<AnimatePresence initial={false} custom={swap}>
									{ids.length > 0 || overflow.length > 0 ? (
										<Grow key="separator" still={opening !== null || ids.some((id) => id === lit)}>
											<span data-ui="top-tab-separator" />
										</Grow>
									) : null}
									{shown.map((id) => (
										<Grow key={id} lead={lit === id} still={id === opening}>
											{room.includes(id) ? (
												<span data-ui="tab-room" />
											) : (
												<ReviewTabItem id={id} active={lit === id} current={current === id} />
											)}
										</Grow>
									))}
									{overflow.length > 0 ? (
										<Grow key="more" still={swap || (opening !== null && overflow.includes(opening))}>
											<Overflow ids={overflow} holdsActive={overflow.some((id) => id === lit)} />
										</Grow>
									) : null}
								</AnimatePresence>
							) : null}
						</NavPillGroup>
					</div>
				</ContextMenuTrigger>
				<TabMenu tabId={menuTab} active={active} onDelete={setDeleting} />
			</ContextMenu>
			<Ruler rulerRef={rulerRef} waiting={waiting} reserve={reserve} />
			<DeleteReviewDialog
				target={deleting}
				onClose={() => setDeleting(null)}
				onDeleted={(id) => closeReviewTabs([id])}
			/>
		</TabNav>
	);
}
