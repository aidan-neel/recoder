import type { FailureAction } from '@recoder/shared';
import { toast } from '@recoder/ui';

import { useShell } from './shell-store';

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

/** A failed action. With a way out (add a provider, open settings) it stays long enough to use. */
export function errorToast(title: string, description?: string, action?: FailureAction): void {
	const button = actionFor(action);

	toast.error(title, { description, duration: button ? 10000 : 6000, action: button });
}
