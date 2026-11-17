'use client';

import { toast } from '@recoder/ui';

import type { ListStore } from '../pulls/list-store';
import { errorToast } from '../shell/notify';

/** How long Undo stays on offer, as on the app's other Undo toasts. */
const UNDO_MS = 5000;

/** Removals still waiting on their toast, so a page that closes first sends them anyway. */
const waiting = new Set<() => void>();

/** Sends every removal still waiting, as the page goes away. */
function flush(): void {
	for (const commit of [...waiting]) commit();
}

/**
 * Stops tracking a repository with a real Undo. It leaves every list at once, but the server forgets it only when the
 * toast goes: it times out, is dismissed, or the page closes. Undo puts it back as it was, so its reviews still
 * attach. A removal the server refuses brings it back with the reason.
 */
export function stopTracking(store: ListStore, repo: { id: string; name: string }): void {
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

		store.untrack(repo.id).catch((error: unknown) => {
			errorToast(`Couldn’t stop tracking ${repo.name}`, error instanceof Error ? error.message : undefined);
		});
	}

	function undo(): void {
		if (!settle()) return;

		toast.dismiss(toastId);
		store.restoreRepo(repo.id);
	}

	waiting.add(commit);
	window.addEventListener('pagehide', flush);
	store.hideRepo(repo.id);

	const toastId = toast.success(`Stopped tracking ${repo.name}`, {
		duration: UNDO_MS,
		action: { label: 'Undo', onClick: undo },
		onAutoClose: commit,
		onDismiss: commit
	});
}
