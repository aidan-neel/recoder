'use client';

import { SkeletonRows, StatusGlyph, type GlyphKind } from '@recoder/ui';
import { GitPullRequest } from 'lucide-react';
import { usePathname } from '@/lib/shell/navigation';

import { useSessionCache } from '@/lib/api/client';
import { shortAge } from '@/lib/shell/age';
import { useSettleMarks } from '@/lib/shell/settle';
import { useSidebarFolds } from '@/lib/shell/sidebar-folds';
import type { RecentReview } from '@/lib/shell/types';
import { useNow } from '@/lib/shell/use-now';

import { RepoLabel } from '@/components/common/repo-label';

import { useReviewActions } from './recent-actions';
import { AGE_TICK, RecentCard } from './recent-row';
import { SidebarSection } from './sidebar-section';

/** The glyph for each state of a recent review. */
const GLYPHS: Record<RecentReview['state'], GlyphKind> = {
	queued: 'idle',
	running: 'spinner',
	bugs: 'high',
	clean: 'ok',
	failed: 'failed',
	cancelled: 'cancelled'
};

/** How many placeholder rows stand in while the reviews load. */
const LOADING_ROWS = 4;

/** A review card's height in px: a 16px repository line, a 20px title and a 16px foot inside 8px of padding, so the cards replace their placeholders in place. */
const RECENT_CARD_HEIGHT = 72;

interface RecentReviewsProps {
	reviews: RecentReview[];
	loading: boolean;
}

/**
 * The newest review of each open pull request that is not settled, so the
 * last few stay one click away. With none, the section is left out. Its title folds it away.
 */
export function RecentReviews({ reviews, loading }: RecentReviewsProps) {
	const pathname = usePathname();
	const sessions = useSessionCache();
	const actionsFor = useReviewActions();
	const settle = useSettleMarks((state) => state.mark);
	const now = useNow(AGE_TICK);

	const open = useSidebarFolds((state) => !state.folded.includes('reviews'));
	const setOpen = useSidebarFolds((state) => state.setOpen);

	if (!loading && reviews.length === 0) return null;

	return (
		<SidebarSection title="Reviews" open={open} onOpenChange={(next) => setOpen('reviews', next)} className="recent">
			{loading ? (
				<SkeletonRows
					count={LOADING_ROWS}
					height={RECENT_CARD_HEIGHT}
					lines={2}
					className="recent-list"
					rowClassName="recent-skeleton"
				/>
			) : (
				<div className="recent-list">
					{reviews.map((review) => (
						<RecentCard
							key={review.reviewId}
							href={review.href}
							active={pathname === review.href.split('?')[0]}
							title={review.title}
							repo={<RepoLabel name={review.repoName} forge={review.repoForge} />}
							age={shortAge(review.updatedAt, now)}
							actions={actionsFor(review)}
							onIntent={() => sessions.warm(review.repoId, review.number)}
							onSettle={() => settle(review.reviewId, true)}
							foot={
								<>
									<span className="recent-state">
										<StatusGlyph kind={GLYPHS[review.state]} />
										{review.label}
									</span>
									<span className="recent-pull">
										<GitPullRequest aria-hidden />
										{review.number}
									</span>
								</>
							}
						/>
					))}
				</div>
			)}
		</SidebarSection>
	);
}
