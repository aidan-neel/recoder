'use client';

import { Button, type ButtonVariant } from '@recoder/ui';
import { Plus } from 'lucide-react';

interface AddProviderProps {
	onAdd: () => void;
	/** Quiet in the Providers head; outlined in its empty row, where it is the row's one action. */
	variant?: ButtonVariant;
}

/**
 * Opens the provider modal on its list. It works before the providers load,
 * since the modal waits for them itself, so the head of the group's skeleton
 * holds the same button. A disconnect hands focus here when no row is left
 * (`data-provider-control`).
 */
export function AddProvider({ onAdd, variant = 'ghost' }: AddProviderProps) {
	return (
		<Button variant={variant} data-provider-control="add" onClick={onAdd}>
			<Plus aria-hidden />
			Add provider
		</Button>
	);
}
