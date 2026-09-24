import { serverApi } from './server-api';
import { errorToast, undoToast } from './notify';
import { recentSessions } from './recent-sessions.svelte';
import { sessionState } from './session-state.svelte';
import { closeSessionTab } from './session-tabs';

/** Session waiting on the delete confirmation dialog. */
export const deleteConfirm = $state<{ id: string | null }>({ id: null });

export function isSessionRunning(id: string): boolean {
	const status = recentSessions.reviews.find((review) => review.id === id)?.status;
	return status === 'running' || status === 'queued';
}

/** Menu entry point: always confirms first (DeleteSessionDialog). */
export function requestDeleteSession(id: string): void {
	deleteConfirm.id = id;
}

/** Hide the session and close its tab right away; put both back if the server refuses. */
export async function deleteSession(id: string): Promise<void> {
	const tabIndex = sessionState.sessions.findIndex((session) => session.id === id);
	const tab = sessionState.sessions[tabIndex];
	const snapshot = recentSessions.hide(id);
	await closeSessionTab(id);
	try {
		await serverApi.deleteReview(id);
	} catch (e) {
		// Already gone (e.g. a tab whose review was never created) counts as deleted.
		if (!(e instanceof Error && /not found/i.test(e.message))) {
			recentSessions.unhide(id, snapshot);
			if (tab) sessionState.restore(tab, tabIndex);
			errorToast('Could not delete the session', e instanceof Error ? e.message : undefined);
			return;
		}
	}
	recentSessions.forget(id);
	undoToast(snapshot ? `Deleted session #${snapshot.review.prNumber}` : 'Session deleted');
}
