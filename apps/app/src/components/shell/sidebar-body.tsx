'use client';

import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuTrigger } from '@recoder/ui';

import { useSidebarFolds, type SidebarList } from '@/lib/shell/sidebar-folds';
import type { SettledRow, ShellView } from '@/lib/shell/types';

import { RecentActionsHost } from './recent-actions';
import { RecentChats } from './recent-chats';
import { isBusy, RecentReviews } from './recent-reviews';
import { RowSelectionScope, type PickableRow } from './row-selection';
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

/** The rows of Reviews and Chats on screen, in the order they show, for picking several at once. */
function pickableRows(shell: ShellView, listed: (list: SidebarList) => boolean): PickableRow[] {
	const reviews: PickableRow[] =
		listed('reviews') && !shell.loading
			? shell.recent.map((review) => ({
					id: review.reviewId,
					title: review.title,
					kind: 'review',
					busy: isBusy(review)
				}))
			: [];

	const chats: PickableRow[] = listed('chats')
		? shell.chats.map((chat) => ({ id: chat.chatId, title: chat.title, kind: 'chat', busy: false }))
		: [];

	return [...reviews, ...chats];
}

/**
 * The app's part of the sidebar between its head and foot: the places, the recent reviews and chats, the
 * repositories, and Settled, scrolling as one. A right click anywhere on it that a row's own menu does not take opens a menu that
 * shows or hides Repositories, Chats and Reviews. A hidden list is left out whole, and hiding Chats or Reviews takes its
 * rows out of Settled too. Rows of Reviews and Chats can be picked together and settled at once (`RowSelectionScope`).
 */
export function SidebarBody({ shell }: { shell: ShellView }) {
	const hidden = useSidebarFolds((state) => state.hidden);
	const folded = useSidebarFolds((state) => state.folded);
	const setShown = useSidebarFolds((state) => state.setShown);
	const shown = (list: SidebarList) => !hidden.includes(list);
	const listed = (list: SidebarList) => shown(list) && !folded.includes(list);

	return (
		<RecentActionsHost>
			<RowSelectionScope rows={pickableRows(shell, listed)}>
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
			</RowSelectionScope>
		</RecentActionsHost>
	);
}
