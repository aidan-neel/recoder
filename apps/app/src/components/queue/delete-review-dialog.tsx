'use client';

import { ConfirmDialog } from '@recoder/ui';
import { useState } from 'react';

import { useQueue } from '@/lib/queue/queue-store';

/** The review a delete asks about. */
export interface DeleteTarget {
	id: string;
	/** A running review stops when deleted, so the question says so. */
	running: boolean;
}

interface DeleteReviewDialogProps {
	/** The review to delete; null keeps the dialog closed. */
	target: DeleteTarget | null;
	onClose: () => void;
	/** Deletes it. The queue's delete by default; the review page passes its own, which also leaves the page. */
	remove?: (id: string) => Promise<void>;
	/** Runs once the server has deleted it: close its tab. */
	onDeleted?: (id: string) => void;
}

/** What deleting takes away, said before the person confirms. */
function consequence(running: boolean): string {
	const lost = 'This removes its findings and conversation. This can’t be undone.';

	return running ? `The review is still running and stops now. ${lost}` : lost;
}

/**
 * Asks before deleting a review from the queue, a tab menu or the review
 * page's menu. The confirm button spins while the server works; a failure
 * says why and offers Try again.
 */
export function DeleteReviewDialog({ target, onClose, remove, onDeleted }: DeleteReviewDialogProps) {
	const [shown, setShown] = useState(target);

	if (target && target !== shown) setShown(target);

	async function confirm(): Promise<void> {
		if (!shown) return;

		await (remove ?? useQueue.getState().remove)(shown.id);
		onDeleted?.(shown.id);
	}

	return (
		<ConfirmDialog
			open={target !== null}
			onOpenChange={(open) => !open && onClose()}
			title="Delete this review?"
			description={consequence(shown?.running ?? false)}
			confirmLabel="Delete review"
			destructive
			onConfirm={confirm}
		/>
	);
}
