'use client';

import { Skeleton, StatusGlyph, type GlyphKind } from '@recoder/ui';

import { useApi, useSessionCache } from '@/lib/api/client';
import { shortAge } from '@/lib/shell/age';
import { LOADING_REVIEWS } from '@/lib/shell/loading-reviews';
import { navigate, usePathname } from '@/lib/shell/navigation';
import { newReviewHref } from '@/lib/shell/routes';
import { useSettleMarks } from '@/lib/shell/settle';
import { useSidebarFolds } from '@/lib/shell/sidebar-folds';
import type { RecentReview } from '@/lib/shell/types';
import { useNow } from '@/lib/shell/use-now';

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
 * last few stay one click away. With none, the section is left out. Its title folds it away, its + starts a new
 * review and its ⋯ hides it. While they load, the skeleton is drawn from stand-in rows.
 */
export function RecentReviews({ reviews, loading }: RecentReviewsProps) {
	const { base } = useApi();
	const pathname = usePathname();
	const sessions = useSessionCache();
	const actionsFor = useReviewActions();
	const settle = useSettleMarks((state) => state.mark);
	const now = useNow(AGE_TICK);

	const open = useSidebarFolds((state) => !state.folded.includes('reviews'));
	const setOpen = useSidebarFolds((state) => state.setOpen);
	const setShown = useSidebarFolds((state) => state.setShown);

	if (!loading && reviews.length === 0) return null;

	const shown = loading ? LOADING_REVIEWS : reviews;

	return (
		<SidebarSection
			title="Reviews"
			open={open}
			onOpenChange={(next) => setOpen('reviews', next)}
			className="recent"
			add={{ label: 'New review', onSelect: () => navigate(newReviewHref(base)) }}
			onHide={() => setShown('reviews', false)}
		>
			<Skeleton id="recent-reviews" loading={loading}>
				<div className="recent-list">
					{shown.map((review) => (
						<RecentCard
							key={review.reviewId}
							href={review.href}
							active={pathname === review.href.split('?')[0]}
							title={review.title}
							age={shortAge(review.updatedAt, now)}
							actions={actionsFor(review)}
							onIntent={() => sessions.warm(review.repoId, review.number)}
							onSettle={() => settle(review.reviewId, true)}
							foot={
								<>
									<StatusGlyph kind={GLYPHS[review.state]} />
									<span className="recent-foot-text">
										<span className="recent-status">{review.label}</span> · {review.repoName} #{review.number}
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
