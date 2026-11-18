'use client';

import { HoverList, RowButton } from '@recoder/ui';
import { CaretDownIcon, GitMergeIcon, GitPullRequestIcon, ChatIcon, ArrowUUpLeftIcon } from '@phosphor-icons/react';
import { usePathname } from '@/lib/shell/navigation';
import { useState } from 'react';

import { useChatCache, useSessionCache } from '@/lib/api/client';
import { shortAge } from '@/lib/shell/age';
import { useSettleMarks } from '@/lib/shell/settle';
import type { SettledRow } from '@/lib/shell/types';
import { useNow } from '@/lib/shell/use-now';

import { useChatActions, useReviewActions, type RowAction } from './recent-actions';
import { AGE_TICK, RecentRow } from './recent-row';
import { SidebarSection } from './sidebar-section';

/** How many settled rows show before "Show more". */
const PREVIEW = 5;

const MARKS = {
	merged: { icon: GitMergeIcon, label: 'Merged' },
	closed: { icon: GitPullRequestIcon, label: 'Closed' },
	review: { icon: GitPullRequestIcon, label: 'Review' },
	chat: { icon: ChatIcon, label: 'Chat' }
};

/** The mark for a settled row: how its pull request ended, or what it is. */
function markOf(entry: SettledRow) {
	return MARKS[entry.outcome ?? entry.kind];
}

/**
 * Reviews of pull requests that were merged or closed, and the chats and
 * reviews settled by hand or after three quiet hours, folded away at the
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
	const mark = useSettleMarks((state) => state.mark);
	const now = useNow(AGE_TICK);

	/** The row's menu, led by Unsettle unless its pull request ended, which no mark undoes. */
	function actionsFor(entry: SettledRow): RowAction[] {
		const id = entry.kind === 'review' ? entry.row.reviewId : entry.row.chatId;
		const base = entry.kind === 'review' ? reviewActions(entry.row) : chatActions(entry.row);

		if (entry.outcome) return base;

		return [{ id: 'unsettle', label: 'Unsettle', icon: ArrowUUpLeftIcon, onSelect: () => mark(id, false) }, ...base];
	}

	return (
		<HoverList className="recent-list settled-list" itemSelector="[data-recent]">
			{reviews.map((entry) => {
				const { icon: Icon, label } = markOf(entry);
				const { row } = entry;

				return (
					<RecentRow
						key={entry.kind === 'review' ? entry.row.reviewId : entry.row.chatId}
						href={row.href}
						active={pathname === row.href.split('?')[0]}
						mark={<Icon role="img" aria-label={label} className="recent-mark" />}
						title={row.title}
						trailing={<span className="recent-age">{shortAge(row.updatedAt, now)}</span>}
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
				<RowButton data-recent className="settled-more" onClick={onShowAll}>
					<CaretDownIcon aria-hidden className="recent-mark" />
					Show {hidden} more
				</RowButton>
			) : null}
		</HoverList>
	);
}
