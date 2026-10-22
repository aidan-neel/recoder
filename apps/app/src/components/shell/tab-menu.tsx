'use client';

import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@recoder/ui';

import type { DeleteTarget } from '@/components/queue/delete-review-dialog';
import { copyLink } from '@/lib/shell/copy-link';
import { isSampleReview } from '@/lib/shell/routes';
import { useShell } from '@/lib/shell/shell-store';

import { useTabActions } from './use-tab-actions';

interface TabMenuProps {
	/** The review tab the menu opened over, or null for the Queue tab and the bar itself. */
	tabId: string | null;
	/** The tab the page shows. */
	active: string | null;
	/** Asks before deleting the tab's review. */
	onDelete: (target: DeleteTarget) => void;
}

/**
 * The top bar's context menu: open, close, copy the pull request's link or
 * delete the review under the pointer, or close every tab from the bar. The
 * sample review has no link or server copy, so it only opens and closes.
 */
export function TabMenu({ tabId, active, onDelete }: TabMenuProps) {
	const tabs = useShell((state) => state.tabs);
	const { close, open } = useTabActions();
	const ids = tabs.map((tab) => tab.id);
	const at = tabId ? ids.indexOf(tabId) : -1;
	const tab = tabs[at];

	if (!tab) {
		return (
			<ContextMenuContent className="min-w-[13rem]">
				<ContextMenuItem disabled={ids.length === 0} onSelect={() => close(ids)}>
					Close all tabs
				</ContextMenuItem>
			</ContextMenuContent>
		);
	}

	const url = tab.url;
	const real = !isSampleReview(tab.id);

	return (
		<ContextMenuContent className="min-w-[13rem]">
			{tab.id !== active ? (
				<>
					<ContextMenuItem onSelect={() => open(tab.id)}>Open</ContextMenuItem>
					<ContextMenuSeparator />
				</>
			) : null}
			<ContextMenuItem onSelect={() => close([tab.id])}>Close tab</ContextMenuItem>
			<ContextMenuItem disabled={ids.length < 2} onSelect={() => close(ids.filter((id) => id !== tab.id))}>
				Close other tabs
			</ContextMenuItem>
			<ContextMenuItem disabled={at === ids.length - 1} onSelect={() => close(ids.slice(at + 1))}>
				Close tabs to the right
			</ContextMenuItem>
			{url || real ? <ContextMenuSeparator /> : null}
			{url ? <ContextMenuItem onSelect={() => copyLink(url)}>Copy pull request link</ContextMenuItem> : null}
			{real ? (
				<ContextMenuItem destructive onSelect={() => onDelete({ id: tab.id, running: tab.open === null })}>
					Delete review
				</ContextMenuItem>
			) : null}
		</ContextMenuContent>
	);
}
