'use client';

import { useEffect } from 'react';

/** Asks before the page unloads while `dirty` holds unsaved text. */
export function useUnloadGuard(dirty: boolean): void {
	useEffect(() => {
		if (!dirty) return;

		function hold(event: BeforeUnloadEvent): void {
			event.preventDefault();
		}

		window.addEventListener('beforeunload', hold);

		return () => window.removeEventListener('beforeunload', hold);
	}, [dirty]);
}
