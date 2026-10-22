'use client';

import type { Repo } from '@recoder/shared';
import { toast } from '@recoder/ui';

import { failureText } from '@/lib/api/http';
import { useConnections } from '@/lib/connections/connections-store';
import { errorToast } from '@/lib/shell/notify';

/** How long Undo stays on offer, as on the app's other Undo toasts. */
const UNDO_MS = 5000;

/** Removals still waiting on their toast, so a page that closes first sends them anyway. */
const waiting = new Set<() => void>();

/** Sends every removal still waiting, as the page goes away. */
function flush(): void {
	for (const commit of [...waiting]) commit();
}

/**
 * Stops tracking a repository with a real Undo. The row leaves the list at
 * once, but the server forgets the repository only when the toast goes: it
 * times out, is dismissed, or the page closes. Undo, or adding the same
 * repository again before then, puts the row back in its place with the same
 * id, so its reviews and dismissals still attach. A removal the server
 * refuses brings the row back with the reason.
 */
export function stopTracking(repo: Repo): void {
	const store = useConnections.getState();
	let settled = false;

	/** Claims the toast's one outcome; false when Undo or the removal already took it. */
	function settle(): boolean {
		if (settled) return false;

		settled = true;
		waiting.delete(commit);

		if (waiting.size === 0) window.removeEventListener('pagehide', flush);

		return true;
	}

	function commit(): void {
		if (!settle()) return;

		store.removeRepo(repo).catch((error: unknown) => {
			errorToast(`Couldn’t stop tracking ${repo.name}`, failureText(error, 'The server didn’t remove it.'));
		});
	}

	/** Calls off the removal and takes the toast away; false once the removal went out or Undo already ran. */
	function cancel(): boolean {
		if (!settle()) return false;

		toast.dismiss(toastId);

		return true;
	}

	function undo(): void {
		if (cancel()) store.restoreRepo(repo);
	}

	waiting.add(commit);
	window.addEventListener('pagehide', flush);

	const toastId = toast.success(`Stopped tracking ${repo.name}`, {
		duration: UNDO_MS,
		action: { label: 'Undo', onClick: undo },
		onAutoClose: commit,
		onDismiss: commit
	});

	store.hideRepo(repo, cancel);
}
