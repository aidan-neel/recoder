'use client';

import { useEffect, useState } from 'react';

/** How often the count is read; a whole second changes at most once a tick. */
const TICK_MS = 250;

/**
 * Whole seconds since `startedAt` while `running`, counted on the page's clock; null when it is not running or has
 * no start. It keeps no timer while idle.
 */
export function useElapsedSeconds(startedAt: string | null, running: boolean): number | null {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (!running) return;

		const timer = setInterval(() => setNow(Date.now()), TICK_MS);

		return () => clearInterval(timer);
	}, [running]);

	if (!running || startedAt === null) return null;

	return Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
}
