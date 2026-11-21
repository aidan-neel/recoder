'use client';

import { Pill, Skeleton, StatusGlyph, type GlyphKind, type PillTone } from '@recoder/ui';
import { GitPullRequestIcon } from '@phosphor-icons/react';

import { useApi, useSessionCache } from '@/lib/api/client';
import { shortAge } from '@/lib/shell/age';
import { LOADING_REVIEWS } from '@/lib/shell/loading-reviews';
import { navigate, usePathname } from '@/lib/shell/navigation';
import { newReviewHref } from '@/lib/shell/routes';
import { useUnread } from '@/lib/shell/seen';
import { useSettleMarks } from '@/lib/shell/settle';
import { useSidebarFolds } from '@/lib/shell/sidebar-folds';
import type { RecentReview } from '@/lib/shell/types';
import { useNow } from '@/lib/shell/use-now';

import { useReviewActions } from './recent-actions';
import { AGE_TICK, ThreadRow } from './recent-row';
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

/** The tone of each state's pill on a detailed row. */
const TONES: Record<RecentReview['state'], PillTone> = {
	queued: 'question',
	running: 'question',
	bugs: 'high',
	clean: 'ok',
	failed: 'danger',
	cancelled: 'question'
};

/** A review that is still working, so it is neither settled nor unread until its result lands. */
function isBusy(review: RecentReview): boolean {
	return review.state === 'running' || review.state === 'queued';
}

/** A review's state as a pill: its label on its tone, with the spinner while it runs. */
function StatePill({ review }: { review: RecentReview }) {
	const icon = review.state === 'running' ? <StatusGlyph kind="spinner" className="thread-pill-glyph" /> : undefined;

	return (
		<Pill tone={TONES[review.state]} icon={icon} className="thread-pill">
			{review.label}
		</Pill>
	);
}

/** Where a review lives: its repository and pull request number. */
function ReviewPlace({ review }: { review: RecentReview }) {
	return (
		<>
			<GitPullRequestIcon aria-hidden />
			<span className="thread-place-text">
				{review.repoName} #{review.number}
			</span>
		</>
	);
}

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
	const settle = useSettleMarks((state) => state.settle);
	const now = useNow(AGE_TICK);
	const isActive = (review: RecentReview) => pathname === review.href.split('?')[0];
	const shownRow = reviews.find(isActive);

	const unread = useUnread(
		shownRow && { id: shownRow.reviewId, updatedAt: shownRow.updatedAt, busy: isBusy(shownRow) }
	);

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
				<div className="thread-list">
					{shown.map((review) => (
						<ThreadRow
							key={review.reviewId}
							href={review.href}
							active={isActive(review)}
							title={review.title}
							age={shortAge(review.updatedAt, now)}
							glyph={<StatusGlyph kind={GLYPHS[review.state]} />}
							place={<ReviewPlace review={review} />}
							pill={<StatePill review={review} />}
							status={review.label}
							unread={!loading && unread(review.reviewId, review.updatedAt, isBusy(review))}
							actions={actionsFor(review)}
							onIntent={() => sessions.warm(review.repoId, review.number)}
							onSettle={() => settle(review.reviewId)}
						/>
					))}
				</div>
			</Skeleton>
		</SidebarSection>
	);
}
