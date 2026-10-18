'use client';

import { useCallback, useState, type ReactNode } from 'react';

/** The open-state props a modal or popover root takes: controlled with `open`, or uncontrolled with `defaultOpen`. */
export interface OpenProps {
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	children: ReactNode;
}

/**
 * Owns an overlay's open state, so its content can read it and keep the panel
 * mounted while it animates out. A given `open` wins; otherwise local state
 * starts at `defaultOpen`. Every change reaches `onOpenChange`.
 */
export function useOpenState({ open, defaultOpen = false, onOpenChange }: Omit<OpenProps, 'children'>) {
	const [local, setLocal] = useState(defaultOpen);

	const change = useCallback(
		(next: boolean) => {
			if (open === undefined) setLocal(next);

			onOpenChange?.(next);
		},
		[open, onOpenChange]
	);

	return [open ?? local, change] as const;
}
