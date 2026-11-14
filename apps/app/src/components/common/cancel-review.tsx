'use client';

import { Button, ConfirmDialog, type ButtonVariant } from '@recoder/ui';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

import { useRunView } from '@/lib/run/use-run';

/** Opens the question; it comes from the host, which outlives every banner and card that asks. */
const AskContext = createContext<(() => void) | null>(null);

/**
 * Holds the "Cancel this review?" dialog for a pull request's page. The
 * review's banner or card that asks is replaced the moment the review stops,
 * so the dialog lives here, above them, and plays its exit as usual. A
 * cancelled review keeps no findings and cannot be resumed. When the dialog
 * closes, focus returns to the Cancel button if it is still there, else to
 * the new banner's primary action.
 */
export function CancelReviewHost({ children }: { children: ReactNode }) {
	const run = useRunView();
	const [asking, setAsking] = useState(false);
	const ask = useCallback(() => setAsking(true), []);

	/** The Cancel button is gone once the review stopped; the banner's button marked `data-run-primary` names the next step. */
	function focusPrimary(event: Event): void {
		const primary = document.querySelector<HTMLElement>('[data-run-primary]');

		if (!primary) return;

		event.preventDefault();
		primary.focus();
	}

	return (
		<AskContext.Provider value={ask}>
			{children}
			<ConfirmDialog
				open={asking}
				onOpenChange={setAsking}
				title="Cancel this review?"
				description="The review stops and the findings so far are dropped. You can start a new one."
				confirmLabel="Cancel review"
				cancelLabel="Keep reviewing"
				destructive
				onConfirm={run.cancel}
				onCloseAutoFocus={focusPrimary}
			/>
		</AskContext.Provider>
	);
}

/** The Cancel button of a review that is queued, running or paused; it asks the host's dialog. */
export function CancelReviewButton({ variant }: { variant: ButtonVariant }) {
	const ask = useContext(AskContext);

	if (!ask) throw new Error('CancelReviewButton must be inside a CancelReviewHost.');

	return (
		<Button variant={variant} onClick={ask}>
			Cancel
		</Button>
	);
}
