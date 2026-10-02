import { toast } from '@sivir-ui/svelte/components/toast';
import type { FailureAction } from '@recoder/shared';
import { modelSettingsUi } from './model-settings.svelte';

/** Toast for pushed or destructive actions: rises 12px, dwells 5s, offers Undo. */
export function undoToast(title: string, undo?: () => void): void {
	toast.success(title, {
		duration: 5000,
		actions: undo ? [{ label: 'Undo', variant: 'ghost', callback: undo }] : undefined
	});
}

/** Errors that settings can fix carry a button there; `sign-in` also opens Add provider. */
export function errorToast(title: string, description?: string, action?: FailureAction): void {
	toast.error(title, {
		description,
		duration: action ? 10_000 : 6000,
		actions: action
			? [
					action === 'sign-in'
						? {
								label: 'Add a provider',
								variant: 'ghost',
								callback: () => modelSettingsUi.show('models', { kind: 'add-provider' })
							}
						: { label: 'Open settings', variant: 'ghost', callback: () => modelSettingsUi.show('models') }
				]
			: undefined
	});
}
