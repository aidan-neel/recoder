'use client';

import type { Review, ReviewProgress } from '@recoder/shared';

import { livePhase, type LivePhase } from '@/lib/live/live-progress';
import { reviewerRows } from '@/lib/live/reviewers';
import { stageDetail, stageRows } from '@/lib/live/stages';
import { useReview } from '@/lib/review/review-store';

import { LiveHeader } from './live-header';
import { ReviewerList } from './reviewer-list';
import { StageList, StageListSkeleton } from './stage-list';

interface ProgressProps {
	review: Review;
	progress: ReviewProgress | null;
	phase: LivePhase;
}

/** The stages and the reviewers. Until the stream's first snapshot lands, placeholder rows hold their place. */
function LiveProgress({ review, progress, phase }: ProgressProps) {
	if (!progress) {
		return (
			<div data-ui="live-progress" className="live-progress" aria-busy>
				<StageListSkeleton />
			</div>
		);
	}

	return (
		<div data-ui="live-progress" className="live-progress">
			<StageList rows={stageRows(progress, phase, review.status)} detail={stageDetail(progress, review.status)} />
			<ReviewerList rows={reviewerRows(progress.assignments, phase)} />
		</div>
	);
}

/**
 * A review that is queued, running, paused or still a draft, before it has
 * decisions: where it stands, then its stages and reviewers. A draft has no
 * progress yet, so it shows the lead and Start review. The conversation with
 * Orchestrator lives in the ask column, which the header's button opens.
 */
export function ReviewRunning() {
	const review = useReview((state) => state.review);
	const progress = useReview((state) => state.progress);
	const phase = review ? livePhase(review.status, progress) : null;

	if (!review || !phase) return null;

	return (
		<div data-ui="live" data-phase={phase} className="live">
			<LiveHeader review={review} phase={phase} />
			{phase === 'draft' ? null : <LiveProgress review={review} progress={progress} phase={phase} />}
		</div>
	);
}
