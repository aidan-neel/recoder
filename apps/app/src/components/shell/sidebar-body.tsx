'use client';

import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuTrigger } from '@recoder/ui';

import { useSidebarFolds, type SidebarList } from '@/lib/shell/sidebar-folds';
import type { SettledRow, ShellView } from '@/lib/shell/types';

import { RecentActionsHost } from './recent-actions';
import { RecentChats } from './recent-chats';
import { RecentReviews } from './recent-reviews';
import { SettledReviews } from './settled-reviews';
import { SidebarNav } from './sidebar-nav';
import { SidebarRepos } from './sidebar-repos';

/** The lists the sidebar's menu shows or hides, in the order they stack. */
const LIST_NAMES: Record<SidebarList, string> = { reviews: 'Reviews', chats: 'Chats', repos: 'Repositories' };

const LISTS = Object.keys(LIST_NAMES) as SidebarList[];

/** The list a settled row came from. */
function listOf(entry: SettledRow): SidebarList {
	return entry.kind === 'chat' ? 'chats' : 'reviews';
}

/**
 * The app's part of the sidebar between its head and foot: the places, the recent reviews and chats, the
 * repositories, and Settled, scrolling as one. A right click anywhere on it that a row's own menu does not take opens a menu that
 * shows or hides Repositories, Chats and Reviews. A hidden list is left out whole, and hiding Chats or Reviews takes its
 * rows out of Settled too.
 */
export function SidebarBody({ shell }: { shell: ShellView }) {
	const hidden = useSidebarFolds((state) => state.hidden);
	const setShown = useSidebarFolds((state) => state.setShown);
	const shown = (list: SidebarList) => !hidden.includes(list);

	return (
		<RecentActionsHost>
			<ContextMenu>
				<ContextMenuTrigger>
					<div className="sidebar-body">
						<SidebarNav openPulls={shell.openPulls} />
						{shown('reviews') ? <RecentReviews reviews={shell.recent} loading={shell.loading} /> : null}
						{shown('chats') ? <RecentChats chats={shell.chats} /> : null}
						{shown('repos') ? <SidebarRepos repos={shell.repos} /> : null}
						<SettledReviews reviews={shell.settled.filter((entry) => shown(listOf(entry)))} />
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent>
					{LISTS.map((list) => (
						<ContextMenuCheckboxItem
							key={list}
							checked={shown(list)}
							onCheckedChange={(checked) => setShown(list, checked)}
						>
							{LIST_NAMES[list]}
						</ContextMenuCheckboxItem>
					))}
				</ContextMenuContent>
			</ContextMenu>
		</RecentActionsHost>
	);
}
