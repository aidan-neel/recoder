import { taskSummary, type Review, type ReviewProgress } from '@recoder/shared';

import type { ReviewPhase } from '../review/lifecycle';
import type { Connection } from '../review/review-stream';

/** Where a review that is still a draft or at work stands, as the live view tells it. */
export type LivePhase = 'draft' | 'queued' | 'running' | 'paused';

/** The phase from the stored status and the live `paused` flag; null once the review has ended. */
export function livePhase(status: Review['status'], progress: ReviewProgress | null): LivePhase | null {
	if (status === 'draft' || status === 'queued') return status;
	if (status === 'running') return progress?.paused ? 'paused' : 'running';

	return null;
}

interface StepProgress {
	done: number;
	total: number;
	/** How full the meter is, 0 to 1; null slides while the plan is still unknown. */
	share: number | null;
	/** True when "done of total" means something: the plan is known and the review is not waiting for a slot. */
	counted: boolean;
}

/**
 * Steps done of steps known, read the same way by the live header and the
 * strip over a review with decisions. `taskSummary` leaves out `partial` (a
 * check that ran but could not verify), which is finished too, so it counts
 * here; without it the meter never reaches the end. The plan is known once
 * reviewers are assigned: before that the total still grows with every step,
 * so the count hides and the meter slides. A queued review rests empty, even
 * with steps kept from an earlier run.
 */
export function stepProgress(progress: ReviewProgress | null, phase: ReviewPhase): StepProgress {
	const tasks = Object.values(progress?.tasks ?? {});
	const partial = tasks.filter((task) => task.status === 'partial').length;
	const done = taskSummary(tasks).settled + partial;
	const total = tasks.length;
	const planned = progress?.planVersion !== undefined || (progress?.assignments?.length ?? 0) > 0;

	if (phase === 'queued') return { done, total, share: 0, counted: false };
	if (!planned) return { done, total, share: phase === 'running' ? null : 0, counted: false };

	return { done, total, share: total > 0 ? done / total : 0, counted: total > 0 };
}

/** The quiet line beside the progress while the live stream is not connected; null while it is, or once it closed. */
export function connectionNote(connection: Connection): string | null {
	if (connection === 'reconnecting') return 'Reconnecting…';
	if (connection === 'connecting') return 'Connecting to review';

	return null;
}
