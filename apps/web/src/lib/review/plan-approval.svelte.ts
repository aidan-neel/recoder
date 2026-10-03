import type { ReviewPlanApproval } from '@recoder/shared';
import { serverApi } from '../api/server-api';
import { errorToast } from '../shell/notify';

/** Props for a surface that shows a running review's pause state and asks for the plan's go-ahead. */
export interface PlanApprovalProps {
	paused?: boolean;
	/** A plan waiting for the developer; the review is blocked until answered. */
	approval?: ReviewPlanApproval | null;
	onApprove?: (() => Promise<void>) | null;
	/** Asks to confirm, since declining cancels the review. */
	onDecline?: (() => void) | null;
	approving?: boolean;
}

/** A plan waiting on the developer: the review being approved, and the one whose "No" waits on DeclinePlanDialog. */
export const planApproval = $state<{ approving: string | null; declining: string | null }>({
	approving: null,
	declining: null
});

/** Yes: every planned specialist runs. */
export async function approvePlan(reviewId: string): Promise<void> {
	if (planApproval.approving) return;
	planApproval.approving = reviewId;

	try {
		await serverApi.approvePlan(reviewId);
	} catch (e) {
		errorToast('Could not start the specialists', e instanceof Error ? e.message : undefined);
	} finally {
		planApproval.approving = null;
	}
}

/** No: confirm first, since declining cancels the review. */
export function declinePlan(reviewId: string): void {
	planApproval.declining = reviewId;
}

export async function cancelDeclinedReview(reviewId: string): Promise<void> {
	try {
		await serverApi.cancelReview(reviewId);
	} catch (e) {
		errorToast('Could not stop the review', e instanceof Error ? e.message : undefined);
	}
}
