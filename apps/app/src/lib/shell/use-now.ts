'use client';

import { useEffect, useState } from 'react';

/** The time now, moved on every `ms`, so "checked 2 minutes ago" or a running clock keeps up without a render reading the clock. */
export function useNow(ms: number): number {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), ms);

		return () => clearInterval(timer);
	}, [ms]);

	return now;
}
