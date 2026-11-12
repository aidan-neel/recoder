'use client';

import { HoverList, RowButton, SkeletonRows, StatusGlyph, type GlyphKind } from '@recoder/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { OFFLINE_TEXT } from '@/lib/api/http';
import type { RecentReview } from '@/lib/shell/types';

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

interface RecentReviewsProps {
	reviews: RecentReview[];
	loading: boolean;
	offline: boolean;
}

/** One recent review: its pull request's title, then where it is and how it ended. */
function RecentRow({ review, active }: { review: RecentReview; active: boolean }) {
	return (
		<RowButton asChild data-recent data-active={active || undefined} className="recent-item">
			<Link href={review.href} aria-current={active ? 'page' : undefined}>
				<StatusGlyph kind={GLYPHS[review.state]} />
				<span className="recent-text">
					<span className="recent-title">{review.title}</span>
					<span className="meta">
						{review.repoName} #{review.number}
						<span className="meta-sep">{review.label}</span>
					</span>
				</span>
			</Link>
		</RowButton>
	);
}

/** What stands in the list's place when it has no rows. */
function emptyLine(offline: boolean): string {
	return offline ? OFFLINE_TEXT : 'Reviews you start show here.';
}

/** The newest review of each pull request, so the last few stay one click away. */
export function RecentReviews({ reviews, loading, offline }: RecentReviewsProps) {
	const pathname = usePathname();

	return (
		<section className="recent" aria-label="Recent reviews">
			<h2 className="section-label recent-label">Recent reviews</h2>
			{loading ? <SkeletonRows count={LOADING_ROWS} height={48} glyph lines={2} className="recent-list" /> : null}
			{!loading && reviews.length === 0 ? <p className="recent-empty">{emptyLine(offline)}</p> : null}
			{!loading && reviews.length > 0 ? (
				<HoverList className="recent-list" itemSelector="[data-recent]">
					{reviews.map((review) => (
						<RecentRow key={review.reviewId} review={review} active={pathname === review.href.split('?')[0]} />
					))}
				</HoverList>
			) : null}
		</section>
	);
}
