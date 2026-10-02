import { serverApi } from './server-api';
import { errorToast } from './notify';

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
