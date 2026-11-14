'use client';

import { Collapsible, CollapsibleContent, CollapsibleTrigger, HoverList, RowButton } from '@recoder/ui';
import { ChevronDown, GitMerge, GitPullRequestClosed } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { useSessionCache } from '@/lib/api/client';
import { shortAge } from '@/lib/shell/age';
import type { SettledReview } from '@/lib/shell/types';
import { useNow } from '@/lib/shell/use-now';

import { useReviewActions } from './recent-actions';
import { RecentRow } from './recent-row';

/** How many settled rows show before "Show more". */
const PREVIEW = 5;

/** How often the ages move on, in ms. */
const AGE_TICK = 60_000;

const MARKS = {
	merged: { icon: GitMerge, label: 'Merged' },
	closed: { icon: GitPullRequestClosed, label: 'Closed' }
};

/**
 * Reviews of pull requests that were merged or closed, folded away at the
 * bottom of the sidebar: one line each, the oldest news kept a click off. It
 * shows only when there is one, and starts folded on every load.
 */
export function SettledReviews({ reviews }: { reviews: SettledReview[] }) {
	const [open, setOpen] = useState(false);
	const [showAll, setShowAll] = useState(false);

	if (reviews.length === 0) return null;

	const shown = showAll ? reviews : reviews.slice(0, PREVIEW);
	const hidden = reviews.length - shown.length;

	return (
		<Collapsible open={open} onOpenChange={setOpen} className="settled">
			<RowButton asChild className="settled-head">
				<CollapsibleTrigger>
					<span className="section-label">Settled</span>
					<span className="settled-count">{reviews.length}</span>
					<ChevronDown aria-hidden className="settled-chevron" />
				</CollapsibleTrigger>
			</RowButton>
			<CollapsibleContent>
				<SettledRows reviews={shown} hidden={hidden} onShowAll={() => setShowAll(true)} />
			</CollapsibleContent>
		</Collapsible>
	);
}

interface SettledRowsProps {
	reviews: SettledReview[];
	/** How many more rows "Show more" reveals; none hides the button. */
	hidden: number;
	onShowAll: () => void;
}

function SettledRows({ reviews, hidden, onShowAll }: SettledRowsProps) {
	const pathname = usePathname();
	const sessions = useSessionCache();
	const actionsFor = useReviewActions();
	const now = useNow(AGE_TICK);

	return (
		<HoverList className="recent-list settled-list" itemSelector="[data-recent]">
			{reviews.map((review) => {
				const { icon: Icon, label } = MARKS[review.outcome];

				return (
					<RecentRow
						key={review.reviewId}
						href={review.href}
						active={pathname === review.href.split('?')[0]}
						mark={<Icon role="img" aria-label={label} className="recent-mark" />}
						title={review.title}
						trailing={<span className="recent-age">{shortAge(review.updatedAt, now)}</span>}
						actions={actionsFor(review)}
						onIntent={() => sessions.warm(review.repoId, review.number)}
					/>
				);
			})}
			{hidden > 0 ? (
				<RowButton data-recent className="settled-more" onClick={onShowAll}>
					<ChevronDown aria-hidden className="recent-mark" />
					Show {hidden} more
				</RowButton>
			) : null}
		</HoverList>
	);
}
