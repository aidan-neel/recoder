import { activeTab, QUEUE_TAB, queueHref, reviewHref, reviewId } from './routes';
import { useShell } from './shell-store';
import { neighborAfterClose } from './tab-fit';

/**
 * Goes to a tab; the pill heads there before the page arrives. From one
 * review to another the page swaps in place, as settings sections do: the
 * address changes through the history API, which Next keeps in step with
 * `usePathname`, and the review route shows the review its address names
 * (`ReviewRoute`), so the switch waits on no server round trip. A review not
 * kept in memory is read first, briefly, so it paints whole in one swap, and
 * past that wait its skeleton takes the old review's place (`openReview`).
 * While the router is still getting another page, the tab goes through the
 * router too, which drops that navigation; a swap in place would leave it to
 * land later. It reads the store when called, so the bar, its menus and the
 * palette share one stable function and never re-render to get a fresh one.
 */
export function goToTab(id: string): void {
	const { pathname, arriving, setHeading, navigate, openReview } = useShell.getState();

	setHeading(id);

	if (id !== QUEUE_TAB && reviewId(pathname) && !arriving?.sent) {
		openReview(id, () => window.history.pushState(null, '', reviewHref(id)));

		return;
	}

	navigate(id === QUEUE_TAB ? queueHref(pathname) : reviewHref(id));
}

/**
 * Closes review tabs. When the open review is among them, the page first
 * moves to the nearest tab that stays, or to the queue.
 */
export function closeReviewTabs(ids: string[]): void {
	const { tabs, heading, pathname, closeTabs } = useShell.getState();
	const active = heading ?? activeTab(pathname);

	if (active && ids.includes(active)) {
		goToTab(
			neighborAfterClose(
				tabs.map((tab) => tab.id),
				ids,
				active
			) ?? QUEUE_TAB
		);
	}

	closeTabs(ids);
}
