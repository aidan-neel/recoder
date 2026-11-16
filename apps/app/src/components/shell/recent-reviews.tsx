'use client';

import { HoverList, SkeletonRows, StatusGlyph, type GlyphKind } from '@recoder/ui';
import { usePathname } from 'next/navigation';

import { useSessionCache } from '@/lib/api/client';
import { useSidebarFolds } from '@/lib/shell/sidebar-folds';
import type { RecentReview } from '@/lib/shell/types';

import { RepoLabel } from '@/components/common/repo-label';

import { useReviewActions } from './recent-actions';
import { RecentRow } from './recent-row';
import { SidebarSection } from './sidebar-section';

/** The glyph for each state of a recent review. */
const GLYPHS: Record<RecentReview['state'], GlyphKind> = {
	queued: 'idle',
	running: 'spinner',
	bugs: 'high',
	clean: 'ok',
	failed: 'failed'
};

/** How many placeholder rows stand in while the reviews load. */
const LOADING_ROWS = 4;

/** A recent row's height in px: a 18px title and a 16px meta line inside 5px of padding, so the rows replace their placeholders in place. */
const RECENT_ROW_HEIGHT = 44;

interface RecentReviewsProps {
	reviews: RecentReview[];
	loading: boolean;
}

/**
 * The newest review of each open pull request, so the last few stay one click
 * away. With none, the section is left out. Its title folds it away.
 */
export function RecentReviews({ reviews, loading }: RecentReviewsProps) {
	const pathname = usePathname();
	const sessions = useSessionCache();
	const actionsFor = useReviewActions();

	const open = useSidebarFolds((state) => !state.folded.includes('reviews'));
	const setOpen = useSidebarFolds((state) => state.setOpen);

	if (!loading && reviews.length === 0) return null;

	return (
		<SidebarSection title="Reviews" open={open} onOpenChange={(next) => setOpen('reviews', next)} className="recent">
			{loading ? (
				<SkeletonRows
					count={LOADING_ROWS}
					height={RECENT_ROW_HEIGHT}
					glyph
					lines={2}
					className="recent-list"
					rowClassName="recent-skeleton"
				/>
			) : (
				<HoverList className="recent-list" itemSelector="[data-recent]">
					{reviews.map((review) => (
						<RecentRow
							key={review.reviewId}
							href={review.href}
							active={pathname === review.href.split('?')[0]}
							mark={<StatusGlyph kind={GLYPHS[review.state]} />}
							title={review.title}
							actions={actionsFor(review)}
							onIntent={() => sessions.warm(review.repoId, review.number)}
							meta={
								<>
									<RepoLabel name={`${review.repoName} #${review.number}`} forge={review.repoForge} />
									<span className="meta-sep">{review.label}</span>
								</>
							}
						/>
					))}
				</HoverList>
			)}
		</SidebarSection>
	);
}
