import type { ReviewListItem, ReviewProgress } from '@recoder/shared';

import { isCancelled } from '../pulls/pull-rows';
import type { RunPhase } from './types';

/** Where a review stands: a draft session is no review yet, and a held running review is paused. */
export function runPhase(review: ReviewListItem | null, progress: ReviewProgress | null): RunPhase {
	if (!review || review.status === 'draft') return 'none';
	if (review.status === 'running' && progress?.paused) return 'paused';
	if (isCancelled(review)) return 'cancelled';

	return review.status;
}
