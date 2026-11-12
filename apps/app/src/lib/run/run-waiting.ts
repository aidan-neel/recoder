import type { ReviewProgress, ReviewWorkerWait } from '@recoder/shared';

import { plural } from '../shell/format';

/** A queued review's place in line for a review worker: the reviews ahead of it, and how many run now. */
function workerWaitText(wait: ReviewWorkerWait): string {
	if (wait.running === 0) return 'Waiting for a review worker';

	const busy = `${wait.running} running`;

	return wait.position <= 1 ? `Next in line, ${busy}` : `${plural(wait.position - 1, 'review')} ahead, ${busy}`;
}

/**
 * Why a queued review has not started, in a few words: its place in line
 * when every review worker is busy, else what a waiting task says.
 */
export function waitingReason(progress: ReviewProgress | null): string | null {
	if (progress?.workerWait) return workerWaitText(progress.workerWait);

	return Object.values(progress?.tasks ?? {}).find((task) => task.queueReason)?.queueReason ?? null;
}
