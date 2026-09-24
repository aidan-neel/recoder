import { toast } from '@sivir-ui/svelte/components/toast';

/** Toast for pushed or destructive actions: rises 12px, dwells 5s, offers Undo. */
export function undoToast(title: string, undo?: () => void): void {
	toast.success(title, {
		duration: 5000,
		actions: undo ? [{ label: 'Undo', variant: 'ghost', callback: undo }] : undefined
	});
}

export function errorToast(title: string, description?: string): void {
	toast.error(title, { description, duration: 6000 });
}
