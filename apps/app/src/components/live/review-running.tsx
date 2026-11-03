'use client';

import type { Review, ReviewProgress } from '@recoder/shared';

import { livePhase, type LivePhase } from '@/lib/live/live-progress';
import { isSubagent, reviewerRows } from '@/lib/live/reviewers';
import { stageTimes } from '@/lib/live/stage-times';
import { stageNote, stageRows } from '@/lib/live/stages';
import { useReview } from '@/lib/review/review-store';

import { LiveHeader } from './live-header';
import { ReadyPanel } from './ready-panel';
import { StageList, StageListSkeleton, type TimelineStage } from './stage-list';

/** Every listed stage with its line, its time and, for Review and Subagents, their reviewers. */
function timeline(review: Review, progress: ReviewProgress, phase: LivePhase): TimelineStage[] {
	const rows = stageRows(progress, phase, review.status);
	const times = stageTimes(progress, rows);
	const reviewers = (progress.assignments ?? []).filter((assignment) => !isSubagent(assignment));
	const subagents = (progress.assignments ?? []).filter(isSubagent);

	return rows.map((row) => ({
		row,
		note: stageNote(row, progress, review.status),
		time: times.get(row.key) ?? { took: null, since: null },
		reviewers:
			row.key === 'reviewing' || row.key === 'subagents'
				? reviewerRows(row.key === 'reviewing' ? reviewers : subagents, phase, progress.toolCalls)
				: null
	}));
}

/**
 * A review that is queued, running, paused or still a draft: where it
 * stands, then its stages on a timeline, and once anything is open the way
 * to read it. Until the stream's first snapshot lands, placeholder stages
 * hold their place. A draft has no progress yet, so it shows the lead and
 * Start review. The conversation with Orchestrator lives in the ask column,
 * which the header's button opens.
 */
export function ReviewRunning() {
	const review = useReview((state) => state.review);
	const progress = useReview((state) => state.progress);
	const phase = review ? livePhase(review.status, progress) : null;

	if (!review || !phase) return null;

	return (
		<div data-ui="live" data-phase={phase} className="live">
			<LiveHeader review={review} phase={phase} />
			{phase === 'draft' ? null : progress ? (
				<StageList stages={timeline(review, progress, phase)} />
			) : (
				<div aria-busy>
					<StageListSkeleton />
				</div>
			)}
			{phase === 'draft' ? null : <ReadyPanel />}
		</div>
	);
}
