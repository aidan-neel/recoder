'use client';

import { useSessionData } from '../pull/pull-session';

/**
 * True from the page naming its newest review until that review's record
 * arrives. In between, the session holds no review, which reads the same as a
 * pull request nobody reviewed, so the Summary waits on its skeleton instead of
 * saying so. A record that failed to load ends the wait, so its error can show.
 */
export function useReviewArriving(): boolean {
	const listed = useSessionData((data) => data.page.value?.review?.id ?? null);
	const shown = useSessionData((data) => data.review?.id ?? null);
	const load = useSessionData((data) => data.reviewLoad);

	if (load === 'loading') return true;

	return listed !== null && shown === null && load !== 'failed';
}
