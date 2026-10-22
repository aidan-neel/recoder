'use client';

import { usePathname, useRouter } from 'next/navigation';

import { activeTab, QUEUE_TAB, queueHref, reviewHref } from '@/lib/shell/routes';
import { useShell } from '@/lib/shell/shell-store';
import { neighborAfterClose } from '@/lib/shell/tab-fit';

/** Opening and closing review tabs, so the bar, its menus and the palette behave alike. */
export function useTabActions() {
	const router = useRouter();
	const pathname = usePathname();

	/** Goes to a tab; the pill heads there before the page arrives. */
	function go(id: string): void {
		useShell.getState().setHeading(id);
		router.push(id === QUEUE_TAB ? queueHref(pathname) : reviewHref(id));
	}

	/**
	 * Closes tabs. When the open review is among them, the page first moves to
	 * the nearest tab that stays, or to the queue.
	 */
	function close(ids: string[]): void {
		const { tabs, heading, closeTabs } = useShell.getState();
		const active = heading ?? activeTab(pathname);

		if (active && ids.includes(active)) {
			go(
				neighborAfterClose(
					tabs.map((tab) => tab.id),
					ids,
					active
				) ?? QUEUE_TAB
			);
		}

		closeTabs(ids);
	}

	return { close, open: go };
}
