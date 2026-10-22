'use client';

import { ContextMenu, ContextMenuTrigger, NavPillGroup } from '@recoder/ui';
import { AnimatePresence } from 'motion/react';
import { usePathname } from 'next/navigation';
import { useState, type MouseEvent, type Ref } from 'react';

import { DeleteReviewDialog, type DeleteTarget } from '@/components/queue/delete-review-dialog';
import { pullRef } from '@/lib/shell/format';
import { activeTab, inSample, QUEUE_TAB, queueHref, reviewHref } from '@/lib/shell/routes';
import { useShell, type ReviewTab } from '@/lib/shell/shell-store';
import { neighborAfterClose, type TabFit } from '@/lib/shell/tab-fit';

import { Grow } from './grow';
import { QueueTabLabel, ReviewTabLabel, tabTitle } from './tab-label';
import { TabMenu } from './tab-menu';
import { TabOverflow } from './tab-overflow';
import { TabRuler } from './tab-ruler';
import { TopTab } from './top-tab';
import { usePillTab } from './use-pill-tab';
import { useTabActions } from './use-tab-actions';

interface TabStripProps {
	/** The tab the page shows: the queue, a review id, or null on settings. */
	active: string | null;
	/** What fits; null until the first measure, when only the Queue tab shows. */
	fit: TabFit | null;
	rulerRef: Ref<HTMLDivElement>;
}

/**
 * True while the strip shows a tab that just came out of the More menu
 * because it opened. The tabs it displaces leave at once, so the pill slides
 * to where the tab stays instead of chasing it while the bar reflows. Any
 * other change to the tabs or the menu turns it off again.
 */
function useSwap(lit: string | null, tabs: ReviewTab[], hidden: string[]): boolean {
	const key = `${tabs.map((tab) => tab.id).join(' ')}|${hidden.join(' ')}`;
	const [last, setLast] = useState({ key, hidden, swap: false });

	if (last.key === key) return last.swap;

	const swap = !!lit && last.hidden.includes(lit) && !hidden.includes(lit);

	setLast({ key, hidden, swap });

	return swap;
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
 * The Queue tab, then one tab per open review, then a More menu for the ones
 * that do not fit. The active tab sits on a pill that slides between tabs; a
 * new tab grows in and a closed one collapses while the rest reflow.
 */
export function TabStrip({ active, fit, rulerRef }: TabStripProps) {
	const pathname = usePathname();
	const tabs = useShell((state) => state.tabs);
	const waiting = useShell((state) => state.waiting[inSample(pathname) ? 'sample' : 'live']);
	const lit = usePillTab(active, tabs);
	const current = activeTab(pathname);
	const { close } = useTabActions();
	const [menuTab, setMenuTab] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
	const hidden = new Set(fit?.hidden);
	const overflow = tabs.filter((tab) => hidden.has(tab.id));
	const swap = useSwap(lit, tabs, fit?.hidden ?? []);

	/**
	 * Closes a tab from its X. Pressed from the keyboard, focus moves to the
	 * tab that takes its place, so the person keeps their spot in the bar.
	 */
	function closeTab(id: string, keyboard: boolean): void {
		const ids = tabs.map((tab) => tab.id);

		close([id]);

		if (keyboard) focusTab(neighborAfterClose(ids, [id], id) ?? QUEUE_TAB);
	}

	/** The context menu acts on the tab under the pointer, or on the bar when there is none. */
	function track(event: MouseEvent): void {
		const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tab]') : null;

		setMenuTab(target?.dataset.tab ?? null);
	}

	return (
		<nav aria-label="Queue and open reviews" className="relative flex h-full min-w-0 flex-1 items-center">
			<ContextMenu>
				<ContextMenuTrigger>
					<div data-ui="top-tabs" onContextMenuCapture={track}>
						<NavPillGroup>
							<TopTab
								id={QUEUE_TAB}
								href={queueHref(pathname)}
								active={lit === QUEUE_TAB}
								current={current === QUEUE_TAB}
							>
								<QueueTabLabel waiting={waiting} />
							</TopTab>
							{fit ? (
								<AnimatePresence initial={false} custom={swap}>
									{tabs.length > 0 ? (
										<Grow key="separator">
											<span data-ui="top-tab-separator" />
										</Grow>
									) : null}
									{tabs
										.filter((tab) => !hidden.has(tab.id))
										.map((tab) => (
											<Grow key={tab.id} lead={lit === tab.id}>
												<TopTab
													id={tab.id}
													href={reviewHref(tab.id)}
													active={lit === tab.id}
													current={current === tab.id}
													title={tabTitle(tab)}
													closeLabel={`Close ${pullRef(tab.repo, tab.pr)}`}
													onClose={(keyboard) => closeTab(tab.id, keyboard)}
												>
													<ReviewTabLabel tab={tab} />
												</TopTab>
											</Grow>
										))}
									{overflow.length > 0 ? (
										<Grow key="more">
											<TabOverflow tabs={overflow} />
										</Grow>
									) : null}
								</AnimatePresence>
							) : null}
						</NavPillGroup>
					</div>
				</ContextMenuTrigger>
				<TabMenu tabId={menuTab} active={active} onDelete={setDeleting} />
			</ContextMenu>
			<TabRuler ref={rulerRef} tabs={tabs} waiting={waiting} />
			<DeleteReviewDialog target={deleting} onClose={() => setDeleting(null)} onDeleted={(id) => close([id])} />
		</nav>
	);
}
