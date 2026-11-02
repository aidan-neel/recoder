'use client';

import type { ButtonStatus } from '@recoder/ui';
import { useEffect, useEffectEvent } from 'react';

/** How long the button shows "Connected" before the modal closes. */
const CONNECTED_MS = 700;

/**
 * Closes a connect modal a beat after its button reads success. A modal
 * closed sooner leaves no timer behind to close the next one.
 */
export function useCloseOnSuccess(status: ButtonStatus, close: () => void): void {
	const onConnected = useEffectEvent(close);

	useEffect(() => {
		if (status !== 'success') return;

		const timer = setTimeout(onConnected, CONNECTED_MS);

		return () => clearTimeout(timer);
	}, [status]);
}
