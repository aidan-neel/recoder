'use client';

import { Skeleton, StatusGlyph, type GlyphKind } from '@recoder/ui';
import { GitPullRequestIcon } from '@phosphor-icons/react';

import { useSessionCache } from '@/lib/api/client';
import { shortAge } from '@/lib/shell/age';
import { LOADING_REVIEWS } from '@/lib/shell/loading-reviews';
import { usePathname } from '@/lib/shell/navigation';
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

interface RecentReviewsProps {
	reviews: RecentReview[];
	loading: boolean;
}

/**
 * The newest review of each open pull request that is not settled, so the
 * last few stay one click away. With none, the section is left out. Its title folds it away.
 * While they load, the skeleton is drawn from stand-in cards.
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

	const shown = loading ? LOADING_REVIEWS : reviews;

	return (
		<SidebarSection title="Reviews" open={open} onOpenChange={(next) => setOpen('reviews', next)} className="recent">
			<Skeleton id="recent-reviews" loading={loading}>
				<div className="recent-list">
					{shown.map((review) => (
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
										<GitPullRequestIcon aria-hidden />
										{review.number}
									</span>
								</>
							}
						/>
					))}
				</div>
			</Skeleton>
		</SidebarSection>
	);
}
