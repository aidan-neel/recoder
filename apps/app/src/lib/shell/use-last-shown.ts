'use client';

import { useState } from 'react';

/**
 * The value, or while it is null the last value that was not, so a part
 * on its way out (the decision bar fading, a tab collapsing) keeps what it
 * showed. A new value lands in the same render.
 */
export function useLastShown<T>(value: T | null): T | null {
	const [last, setLast] = useState(value);

	if (value !== null && value !== last) setLast(value);

	return value ?? last;
}
