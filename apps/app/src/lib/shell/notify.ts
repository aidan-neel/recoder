import type { FailureAction } from '@recoder/shared';
import { toast } from '@recoder/ui';

import { NO_REASON_TEXT } from '../api/http';
import { useShell } from './shell-store';

/** How long a failed action's toast stays when it has a button, long enough to reach it. */
const ACTION_MS = 10_000;

/** What a failure toast with no button says when its error gave no reason: the one step the person has left. */
const LATER_TEXT = 'Try again in a moment.';

/** A finished action, with Undo when it can be taken back. Stays 5 seconds. */
export function undoToast(title: string, undo?: () => void): void {
	toast.success(title, {
		duration: 5000,
		action: undo ? { label: 'Undo', onClick: undo } : undefined
	});
}

/** The way out an error offers, as a toast button. */
function actionFor(action: FailureAction | undefined): { label: string; onClick: () => void } | undefined {
	const go = useShell.getState().navigate;

	if (action === 'sign-in') return { label: 'Add a provider', onClick: () => go('/settings/agent?add=provider') };
	if (action === 'settings') return { label: 'Open settings', onClick: () => go('/settings/agent') };

	return undefined;
}

/**
 * A failed action. With a way out (add a provider, open settings) it stays
 * long enough to use. Without one, a failure that gave no reason says to try
 * again later, since no button beside it offers that.
 */
export function errorToast(title: string, description?: string, action?: FailureAction): void {
	const button = actionFor(action);
	const said = !button && description === NO_REASON_TEXT ? LATER_TEXT : description;

	toast.error(title, { description: said, duration: button ? ACTION_MS : 6000, action: button });
}

/**
 * A save or removal that failed or timed out: what failed, why, and a Try
 * again that sends it again. Returns the toast's id, so a newer change can
 * take it away before its Try again sends an old value.
 */
export function retryToast(title: string, reason: string, retry: () => void): string | number {
	return toast.error(title, {
		description: reason,
		duration: ACTION_MS,
		action: { label: 'Try again', onClick: retry }
	});
}
