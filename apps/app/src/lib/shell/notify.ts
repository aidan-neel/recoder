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

/** A failed action. With a way out (open settings) it stays long enough to use. */
export function errorToast(title: string, description?: string, action?: FailureAction): void {
	const button = action ? { label: 'Open settings', onClick: () => navigate(settingsHref('models')) } : undefined;

	toast.error(title, { description, duration: button ? 10000 : 6000, action: button });
}
