'use client';

import { Icon, RowButton, type IconName } from '@recoder/ui';
import { usePathname } from '@/lib/shell/navigation';
import { useState } from 'react';

import { useChatCache, useSessionCache } from '@/lib/api/client';
import { shortAge } from '@/lib/shell/age';
import { useSettleMarks } from '@/lib/shell/settle';
import type { SettledRow } from '@/lib/shell/types';
import { useNow } from '@/lib/shell/use-now';

import { useChatActions, useReviewActions, type RowAction } from './recent-actions';
import { AGE_TICK, ThreadRow } from './recent-row';
import { SidebarSection } from './sidebar-section';

/** How many settled rows show before "Show more". */
const PREVIEW = 5;

const MARKS: Record<NonNullable<SettledRow['outcome']> | SettledRow['kind'], { icon: IconName; label: string }> = {
	merged: { icon: 'merge', label: 'Merged' },
	closed: { icon: 'pull_request', label: 'Closed' },
	review: { icon: 'pull_request', label: 'Review' },
	chat: { icon: 'chat_bubble', label: 'Chat' }
};

/** The mark for a settled row: how its pull request ended, or what it is. */
function markOf(entry: SettledRow) {
	return MARKS[entry.outcome ?? entry.kind];
}

/**
 * Reviews of pull requests that were merged or closed, reviews settled by hand,
 * and chats settled by hand or after three quiet hours, folded away at the
 * bottom of the sidebar: one line each, the oldest news kept a click off. It
 * shows only when there is one, and starts folded on every load.
 */
export function SettledReviews({ reviews }: { reviews: SettledRow[] }) {
	const [open, setOpen] = useState(false);
	const [showAll, setShowAll] = useState(false);

	if (reviews.length === 0) return null;

	const shown = showAll ? reviews : reviews.slice(0, PREVIEW);
	const hidden = reviews.length - shown.length;

	return (
		<SidebarSection
			title="Settled"
			open={open}
			onOpenChange={setOpen}
			className="settled"
			aside={<span className="settled-count">{reviews.length}</span>}
		>
			<SettledRows reviews={shown} hidden={hidden} onShowAll={() => setShowAll(true)} />
		</SidebarSection>
	);
}

interface SettledRowsProps {
	reviews: SettledRow[];
	/** How many more rows "Show more" reveals; none hides the button. */
	hidden: number;
	onShowAll: () => void;
}

function SettledRows({ reviews, hidden, onShowAll }: SettledRowsProps) {
	const pathname = usePathname();
	const sessions = useSessionCache();
	const chatCache = useChatCache();
	const reviewActions = useReviewActions();
	const chatActions = useChatActions();
	const unsettle = useSettleMarks((state) => state.unsettle);
	const clear = useSettleMarks((state) => state.clear);
	const now = useNow(AGE_TICK);

	/** The row's menu, always led by Unsettle so any settled thread can be brought back. */
	function actionsFor(entry: SettledRow): RowAction[] {
		const id = entry.kind === 'review' ? entry.row.reviewId : entry.row.chatId;
		const base = entry.kind === 'review' ? reviewActions(entry.row) : chatActions(entry.row);
		const restore = entry.kind === 'review' && entry.outcome === null ? () => clear(id) : () => unsettle(id);

		return [{ id: 'unsettle', label: 'Unsettle', icon: 'undo', onSelect: restore }, ...base];
	}

	return (
		<div className="thread-list settled-list">
			{reviews.map((entry) => {
				const { icon, label } = markOf(entry);
				const { row } = entry;

				return (
					<ThreadRow
						key={entry.kind === 'review' ? entry.row.reviewId : entry.row.chatId}
						href={row.href}
						active={pathname === row.href.split('?')[0]}
						density="compact"
						glyph={<Icon name={icon} />}
						status={label}
						place={row.repoName}
						title={row.title}
						age={shortAge(row.updatedAt, now)}
						actions={actionsFor(entry)}
						onIntent={() =>
							entry.kind === 'review'
								? sessions.warm(entry.row.repoId, entry.row.number)
								: chatCache.warm(entry.row.chatId)
						}
					/>
				);
			})}
			{hidden > 0 ? (
				<RowButton className="settled-more" onClick={onShowAll}>
					<Icon name="expand_more" className="settled-more-mark" />
					Show {hidden} more
				</RowButton>
			) : null}
		</div>
	);
}
