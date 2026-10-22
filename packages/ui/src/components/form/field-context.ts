'use client';

import { createContext, use } from 'react';

/** What a `Field` tells the control inside it: the id its label points at, its message id, and whether it failed. */
interface FieldControl {
	id?: string;
	describedBy?: string;
	invalid: boolean;
}

export const FieldContext = createContext<FieldControl | null>(null);

interface ControlProps {
	id?: string;
	describedBy?: string;
	invalid?: boolean;
}

/** The control's own id and description win; otherwise it takes the enclosing `Field`'s, so the label and message wire up. */
export function useFieldControl({ id, describedBy, invalid }: ControlProps): FieldControl {
	const field = use(FieldContext);
	const described = [describedBy, field?.describedBy].filter(Boolean).join(' ');

	return {
		id: id ?? field?.id,
		describedBy: described || undefined,
		invalid: Boolean(invalid ?? field?.invalid)
	};
}
