'use client';

import { useState } from 'react';

/**
 * The modal a connect form lives in. While a key or address is with the
 * server (`sending`) it stays open — Escape and a click outside wait for the
 * answer — so it has no X that would look live but do nothing; the form's
 * Cancel closes it.
 */
export function useHoldModal(onOpenChange: (open: boolean) => void): {
	/** The modal's onOpenChange: a close request waits while `sending`. */
	changeOpen: (next: boolean) => void;
	/** A request is with the server; the modal holds still until it answers. */
	sending: boolean;
	/** The form reports its pending state through this. */
	setSending: (sending: boolean) => void;
} {
	const [sending, setSending] = useState(false);

	function changeOpen(next: boolean): void {
		if (next || !sending) onOpenChange(next);
	}

	return { changeOpen, sending, setSending };
}
