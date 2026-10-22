'use client';

import { Toaster as Sonner, toast, type ToasterProps } from 'sonner';

export { toast };

/**
 * The toast stack, bottom right. Toasts float like menus (the menu shadow) and
 * rise in briefly; an Undo action stays clickable while a modal is open.
 * `offset` moves the stack off the window's edges (16px by default), to clear
 * something floating in that corner.
 */
export function Toaster({ offset = 16 }: { offset?: ToasterProps['offset'] }) {
	return (
		<Sonner
			position="bottom-right"
			gap={8}
			offset={offset}
			visibleToasts={4}
			toastOptions={{
				unstyled: true,
				classNames: {
					toast: 'ui-toast',
					title: 'ui-toast-title',
					description: 'ui-toast-description',
					actionButton: 'ui-toast-action',
					cancelButton: 'ui-toast-action',
					icon: 'ui-toast-icon'
				}
			}}
		/>
	);
}
