import type { FailureAction } from '@recoder/shared';
import { toast } from '@recoder/ui';

import { navigate } from './navigation';
import { settingsHref } from './routes';

/** A finished action, with Undo when it can be taken back. Stays 5 seconds. */
export function undoToast(title: string, undo?: () => void): void {
	toast.success(title, {
		duration: 5000,
		action: undo ? { label: 'Undo', onClick: undo } : undefined
	});
}

/** The way out an error offers, as a toast button. */
function actionFor(action: FailureAction | undefined): { label: string; onClick: () => void } | undefined {
	if (action === 'sign-in')
		return { label: 'Add a provider', onClick: () => navigate(settingsHref('models', { add: 'provider' })) };
	if (action === 'settings') return { label: 'Open settings', onClick: () => navigate(settingsHref('models')) };

	return undefined;
}

/** A failed action. With a way out (add a provider, open settings) it stays long enough to use. */
export function errorToast(title: string, description?: string, action?: FailureAction): void {
	const button = actionFor(action);

	toast.error(title, { description, duration: button ? 10000 : 6000, action: button });
}
